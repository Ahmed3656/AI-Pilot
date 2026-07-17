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
        throw "docker compose $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
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

function Get-StatusCode {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$BearerToken
    )

    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$gatewayBaseUrl$Path")
    try {
        if ($BearerToken) {
            $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $BearerToken)
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        try {
            return [int]$response.StatusCode
        }
        finally {
            $response.Dispose()
        }
    }
    finally {
        $request.Dispose()
    }
}

try {
    $noTokenStatus = Get-StatusCode -Path '/viewer/'
    if ($noTokenStatus -notin @(401, 403, 404)) {
        throw "Viewer without a token was not rejected safely (HTTP $noTokenStatus)."
    }

    $invalidTokenStatus = Get-StatusCode -Path '/viewer/' -BearerToken 'definitely-invalid-phase1-token'
    if ($invalidTokenStatus -notin @(401, 403, 404)) {
        throw "Viewer with an invalid token was not rejected safely (HTTP $invalidTokenStatus)."
    }

    foreach ($path in @('/internal/v1/viewer/authorize', '/ai/health', '/wd/hub/status')) {
        $status = Get-StatusCode -Path $path
        if ($status -ne 404) {
            throw "Internal path $path is unexpectedly public (HTTP $status)."
        }
    }
}
finally {
    $client.Dispose()
    $handler.Dispose()
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

Write-Host "Smoke checks passed ($Profile)."
Write-Host "Viewer rejection: no token HTTP $noTokenStatus; invalid token HTTP $invalidTokenStatus."
Write-Host 'FastAPI, PostgreSQL, WebDriver, and direct noVNC remain internal-only.'
Write-Host 'No browser session was created and no merchant was visited.'
