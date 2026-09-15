param(
    [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"

function Assert-WslAvailable {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw "wsl.exe not found. Enable WSL first."
    }
}

Assert-WslAvailable

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$repoWinForWsl = $repoWin -replace "\\", "/"
$repoWslRaw = & wsl.exe -d $Distro wslpath -a "$repoWinForWsl"
if (-not $repoWslRaw) {
    throw "Failed to convert repository path to WSL path."
}
$repoWsl = $repoWslRaw.Trim()
if (-not $repoWsl) {
    throw "Failed to convert repository path to WSL path."
}

Write-Host "Tailing WSL logs via make monitor (daemon/foreground compatible)..."
& wsl.exe -d $Distro --cd $repoWsl bash -lc "make monitor"
exit $LASTEXITCODE
