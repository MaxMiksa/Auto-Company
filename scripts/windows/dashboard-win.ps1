param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 8787,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "messages-win.ps1")

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$serverScript = Join-Path $repoWin "dashboard\\server.py"
if (-not (Test-Path $serverScript)) {
    throw (Get-AutoCompanyMessage -Key 'Dashboard server script not found: {0}' -Values @($serverScript))
}

. (Join-Path $repoWin 'scripts/install/bootstrap.ps1')
$dashboardPython = Find-BootstrapPython
if (-not $dashboardPython) {
    throw (Get-AutoCompanyMessage -Key 'python not found in PATH.')
}

$url = "http://$BindHost`:$Port"
Write-Host (Get-AutoCompanyMessage -Key 'Starting dashboard server: {0}' -Values @($url))
Write-Host (Get-AutoCompanyMessage -Key 'Press Ctrl+C in this window to stop.')

$serverArgs = @($dashboardPython.Prefix) + @($serverScript, '--host', $BindHost, '--port', $Port)
if (-not $NoBrowser) { $serverArgs += '--open-browser' }
& $dashboardPython.File @serverArgs
exit $LASTEXITCODE
