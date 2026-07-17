[CmdletBinding()]
param(
    [ValidateSet('local-only', 'cloud-tunnel')]
    [string]$Profile = 'local-only',

    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'Test-Phase1Health.ps1') -Profile $Profile -TimeoutSeconds $TimeoutSeconds

$composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
$envFile = Join-Path $PSScriptRoot '.env'
$composeArgs = @('compose', '--project-directory', $PSScriptRoot, '-f', $composeFile, '--profile', $Profile)
if (Test-Path -LiteralPath $envFile) {
    $composeArgs += @('--env-file', $envFile)
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    $output = & docker @composeArgs @Arguments 2>&1
    if (-not $AllowFailure -and $LASTEXITCODE -ne 0) {
        throw 'A Phase 1 smoke command failed without exposing runtime configuration.'
    }
    return $output
}

$gatewayAddress = ((Invoke-Compose -Arguments @('port', 'gateway', '8080')) -join '').Trim()
$gatewayAddress = $gatewayAddress -replace '^0\.0\.0\.0:', '127.0.0.1:' -replace '^\[::\]:', '127.0.0.1:'
$gatewayBaseUrl = "http://$gatewayAddress"

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(10)

function Invoke-GatewayRequest {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$BearerToken,
        [string]$Cookie
    )

    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$gatewayBaseUrl$Path")
    try {
        if ($BearerToken) {
            $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $BearerToken)
        }
        if ($Cookie) {
            $request.Headers.TryAddWithoutValidation('Cookie', $Cookie) | Out-Null
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        try {
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return [pscustomobject]@{
                Status = [int]$response.StatusCode
                Body = $body
                Location = if ($response.Headers.Location) { $response.Headers.Location.ToString() } else { $null }
            }
        }
        finally {
            $response.Dispose()
        }
    }
    finally {
        $request.Dispose()
    }
}

$runId = '01' + [guid]::NewGuid().ToString('N').Substring(0, 24).ToUpperInvariant()
$insertSql = "INSERT INTO shopping_runs (id, category, state, query) VALUES ('$runId', 'retail', 'user_takeover', 'Infrastructure smoke test')"
$deleteSql = "DELETE FROM shopping_runs WHERE id = '$runId'"
$sqlCommand = 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1" >/dev/null'

$viewToken = $null
$controlToken = $null
try {
    Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'sh', '-ec', $sqlCommand, '--', $insertSql) | Out-Null

    $noToken = Invoke-GatewayRequest -Path '/viewer/'
    if ($noToken.Status -ne 401) {
        throw "Viewer without a token was not rejected (HTTP $($noToken.Status))."
    }

    $invalidToken = Invoke-GatewayRequest -Path '/viewer/' -BearerToken 'definitely-invalid-phase1-token'
    if ($invalidToken.Status -ne 401) {
        throw "Viewer with an invalid token was not rejected (HTTP $($invalidToken.Status))."
    }

    foreach ($path in @('/internal/v1/viewer/authorize', '/ai/health', '/wd/hub/status', '/v1/shopping/merchants')) {
        $response = Invoke-GatewayRequest -Path $path
        if ($response.Status -ne 404) {
            throw "Non-public path $path is unexpectedly reachable (HTTP $($response.Status))."
        }
    }

    $eventPath = "/api/v1/shopping/runs/$runId/events"
    $eventHttp = Invoke-GatewayRequest -Path $eventPath
    if ($eventHttp.Status -ne 426) {
        throw "The canonical event path was not proxied to the API (HTTP $($eventHttp.Status))."
    }
    $legacySocket = Invoke-GatewayRequest -Path '/api/v1/shopping/ws'
    if ($legacySocket.Status -ne 404) {
        throw "The legacy shopping socket path is unexpectedly reachable (HTTP $($legacySocket.Status))."
    }

    $viewIssue = Invoke-GatewayRequest -Path "/api/v1/shopping/runs/$runId/viewer-token?mode=view"
    if ($viewIssue.Status -ne 200) {
        throw "A view token could not be issued (HTTP $($viewIssue.Status))."
    }
    $viewToken = ($viewIssue.Body | ConvertFrom-Json).token
    if (-not $viewToken) {
        throw 'The API returned no view token.'
    }
    $viewPage = Invoke-GatewayRequest -Path '/viewer/' -Cookie "dealpilot_viewer=$viewToken"
    if ($viewPage.Status -ne 302 -or $viewPage.Location -notmatch 'view_only=1' -or $viewPage.Location -match [regex]::Escape($viewToken)) {
        throw 'Authenticated view mode did not redirect to a safe view-only noVNC client.'
    }

    $controlIssue = Invoke-GatewayRequest -Path "/api/v1/shopping/runs/$runId/viewer-token?mode=control"
    if ($controlIssue.Status -ne 200) {
        throw "A control token could not be issued (HTTP $($controlIssue.Status))."
    }
    $controlToken = ($controlIssue.Body | ConvertFrom-Json).token
    if (-not $controlToken) {
        throw 'The API returned no control token.'
    }
    $controlPage = Invoke-GatewayRequest -Path '/viewer/' -BearerToken $controlToken
    if ($controlPage.Status -ne 302 -or $controlPage.Location -match 'view_only=1' -or $controlPage.Location -match [regex]::Escape($controlToken)) {
        throw 'Authenticated control mode did not redirect to the temporary interactive noVNC client.'
    }

    foreach ($portCheck in @(
        @{ Service = 'postgres'; Port = '5432' },
        @{ Service = 'api'; Port = '3000' },
        @{ Service = 'ai-service'; Port = '8000' },
        @{ Service = 'browser'; Port = '4444' },
        @{ Service = 'browser'; Port = '7900' }
    )) {
        $published = ((Invoke-Compose -Arguments @('port', $portCheck.Service, $portCheck.Port) -AllowFailure) -join '').Trim()
        if ($published) {
            throw "$($portCheck.Service) port $($portCheck.Port) is unexpectedly published at $published."
        }
    }

    $logs = (Invoke-Compose -Arguments @('logs', '--no-color', '--tail', '300', 'gateway', 'api', 'ai-service')) -join "`n"
    foreach ($secret in @($viewToken, $controlToken)) {
        if ($secret -and $logs.Contains($secret)) {
            throw 'A viewer token appeared in service logs.'
        }
    }
    if ($logs -match '(?i)([?&]token=|data:image/[^;]+;base64,|"screenshot"\s*:)') {
        throw 'Service logs contain a forbidden token URL or screenshot payload.'
    }
}
finally {
    try {
        Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'sh', '-ec', $sqlCommand, '--', $deleteSql) | Out-Null
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

Write-Host "Smoke checks passed ($Profile)."
Write-Host 'Verified canonical routing, schema-backed view/control authorization, internal service authentication, port isolation, and log redaction.'
Write-Host 'No WebDriver session was created, no merchant was visited, and no purchase or booking action was attempted.'
