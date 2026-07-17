[CmdletBinding()]
param(
    [ValidateSet('local-only', 'cloud-tunnel')]
    [string]$Profile = 'local-only',

    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
$envFile = Join-Path $PSScriptRoot '.env'
$composeArgs = @('compose', '--project-directory', $PSScriptRoot, '-f', $composeFile, '--profile', $Profile)
if (Test-Path -LiteralPath $envFile) {
    $composeArgs += @('--env-file', $envFile)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed or is not available on PATH.'
}

function Invoke-Compose {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & docker @composeArgs @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "A Phase 1 container check failed without exposing runtime configuration."
    }
    return $output
}

function Get-ContainerState {
    param([Parameter(Mandatory)][string]$Service)

    $containerId = ((Invoke-Compose -Arguments @('ps', '-a', '-q', $Service)) -join '').Trim()
    if (-not $containerId) {
        return 'missing'
    }

    $state = & docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}' $containerId 2>$null
    if ($LASTEXITCODE -ne 0) {
        return 'inspect-failed'
    }
    return (($state -join '').Trim())
}

$requiredServices = @('postgres', 'api', 'browser', 'ai-service', 'gateway')
if ($Profile -eq 'cloud-tunnel') {
    $requiredServices += 'cloudflared'
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    $pending = @()
    foreach ($service in $requiredServices) {
        $state = Get-ContainerState -Service $service
        $ready = $state -eq 'running|healthy|0' -or ($service -eq 'cloudflared' -and $state -eq 'running|none|0')
        if (-not $ready) {
            $pending += "${service}=${state}"
        }
    }

    if ($pending.Count -eq 0) {
        break
    }

    if ([DateTimeOffset]::UtcNow -ge $deadline) {
        throw "Phase 1 services did not become healthy within $TimeoutSeconds seconds: $($pending -join ', ')"
    }
    Start-Sleep -Seconds 2
} while ($true)

$migrationState = Get-ContainerState -Service 'migrate'
if ($migrationState -ne 'exited|none|0') {
    throw "The migration gate did not complete successfully: $migrationState"
}

$gatewayAddress = ((Invoke-Compose -Arguments @('port', 'gateway', '8080')) -join '').Trim()
if (-not $gatewayAddress) {
    throw 'The gateway loopback port is not published.'
}
$gatewayAddress = $gatewayAddress -replace '^0\.0\.0\.0:', '127.0.0.1:' -replace '^\[::\]:', '127.0.0.1:'
$gatewayBaseUrl = "http://$gatewayAddress"

$gatewayHealth = Invoke-RestMethod -Method Get -Uri "$gatewayBaseUrl/_gateway/health" -TimeoutSec 10
if ($gatewayHealth.status -ne 'ok') {
    throw 'Caddy gateway health response was not healthy.'
}

$apiHealth = Invoke-RestMethod -Method Get -Uri "$gatewayBaseUrl/health/ready" -TimeoutSec 10
if ($apiHealth.status -ne 'ok' -or $apiHealth.dependencies.database -ne 'up') {
    throw 'NestJS API readiness did not confirm its database dependency.'
}

$schemaProbe = 'test "$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT to_regclass(''public.shopping_runs'')::text")" = "shopping_runs"'
Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'sh', '-ec', $schemaProbe) | Out-Null

$aiToApiProbe = @'
import json, os, urllib.error, urllib.request
def status(token):
    request = urllib.request.Request(
        "http://api:3000/internal/v1/secrets/resolve",
        data=b"{}",
        headers={"Content-Type": "application/json", "X-Internal-Token": token},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5)
        return 200
    except urllib.error.HTTPError as error:
        return error.code
assert status("invalid-internal-token") == 401
assert status(os.environ["AI_INTERNAL_TOKEN"]) == 400
'@
Invoke-Compose -Arguments @('exec', '-T', 'ai-service', 'python', '-c', $aiToApiProbe) | Out-Null

$apiToAiProbe = @'
const endpoint = 'http://ai-service:8000/internal/v1/runs';
const check = async (token, body) => (await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-internal-token': token },
  body: JSON.stringify(body),
})).status;
(async () => {
  if (await check('invalid-internal-token', { query: 'Infrastructure authentication probe', category: 'retail' }) !== 401) process.exit(1);
  if (await check(process.env.INTERNAL_TOKEN, {}) !== 422) process.exit(1);
})().catch(() => process.exit(1));
'@
Invoke-Compose -Arguments @('exec', '-T', 'api', 'node', '-e', $apiToAiProbe) | Out-Null

$browserProbe = "import json,urllib.request; data=json.load(urllib.request.urlopen('http://browser:4444/status', timeout=5)); assert data['value']['ready'] is True"
Invoke-Compose -Arguments @('exec', '-T', 'ai-service', 'python', '-c', $browserProbe) | Out-Null

Write-Host "Phase 1 is healthy ($Profile): $gatewayBaseUrl"
Write-Host 'Verified migration completion, schema availability, API-to-AI auth, AI-to-API auth, Selenium, and gateway readiness.'
if ($Profile -eq 'cloud-tunnel') {
    Write-Host 'cloudflared is running; confirm the public hostname separately from the physical phone network.'
}
