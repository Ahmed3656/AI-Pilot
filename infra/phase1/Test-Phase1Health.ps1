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
        throw "docker compose $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

function Get-ContainerState {
    param([Parameter(Mandatory)][string]$Service)

    $containerId = ((Invoke-Compose -Arguments @('ps', '-q', $Service)) -join '').Trim()
    if (-not $containerId) {
        return 'missing'
    }

    $state = & docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $containerId 2>&1
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
        $ready = $state -eq 'running|healthy' -or ($service -eq 'cloudflared' -and $state -eq 'running|none')
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
if ($apiHealth.status -ne 'ok') {
    throw 'NestJS API readiness response was not healthy.'
}

$aiProbe = "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5)); assert data['status']=='ok'"
Invoke-Compose -Arguments @('exec', '-T', 'ai-service', 'python', '-c', $aiProbe) | Out-Null

$browserProbe = "import json,urllib.request; data=json.load(urllib.request.urlopen('http://browser:4444/status', timeout=5)); assert data['value']['ready'] is True"
Invoke-Compose -Arguments @('exec', '-T', 'ai-service', 'python', '-c', $browserProbe) | Out-Null

Write-Host "Phase 1 is healthy ($Profile): $gatewayBaseUrl"
Write-Host 'Verified PostgreSQL, NestJS, FastAPI, Selenium Chromium, noVNC gateway, and Caddy readiness.'
if ($Profile -eq 'cloud-tunnel') {
    Write-Host 'cloudflared is running; confirm the public hostname separately from the physical phone network.'
}
