param(
    [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "messages-win.ps1")
if (-not $PSBoundParameters.ContainsKey("Distro")) { $Distro = Resolve-AutoCompanyDistro }

function Assert-WslAvailable {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw (Get-AutoCompanyMessage -Key 'wsl.exe not found. Enable WSL first.')
    }
}

Assert-WslAvailable

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$repoWinForWsl = $repoWin -replace "\\", "/"
$repoWslRaw = & wsl.exe -d $Distro wslpath -a "$repoWinForWsl"
if (-not $repoWslRaw) {
    throw (Get-AutoCompanyMessage -Key 'Failed to convert repository path to WSL path.')
}
$repoWsl = $repoWslRaw.Trim()
if (-not $repoWsl) {
    throw (Get-AutoCompanyMessage -Key 'Failed to convert repository path to WSL path.')
}

Write-Host (Get-AutoCompanyMessage -Key 'Tailing WSL logs via make monitor (daemon/foreground compatible)...')
& wsl.exe -d $Distro --cd $repoWsl bash -lc "make monitor"
exit $LASTEXITCODE
