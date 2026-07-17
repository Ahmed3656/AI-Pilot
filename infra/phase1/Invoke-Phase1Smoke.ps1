[CmdletBinding()]
param(
    [ValidateSet('local-only', 'cloud-tunnel')]
    [string]$Profile = 'local-only',

    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$check = Join-Path $repositoryRoot 'scripts/phase1-check.mjs'

& node $check smoke --profile $Profile --timeout $TimeoutSeconds
if ($LASTEXITCODE -ne 0) {
    throw 'The cross-platform Phase 1 smoke check failed.'
}
