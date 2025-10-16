param(
    [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"

function Assert-WslAvailable {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw "wsl.exe not found. Enable WSL first."
    }
}

function Get-RepoPaths {
    $repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
    $repoWinForWsl = $repoWin -replace "\\", "/"
    $repoWslRaw = & wsl.exe wslpath -a "$repoWinForWsl"
    if (-not $repoWslRaw) {
        throw "Failed to convert repository path to WSL path."
    }
    $repoWsl = $repoWslRaw.Trim()
    if (-not $repoWsl) {
        throw "Failed to convert repository path to WSL path."
    }
    return @{
        RepoWin = $repoWin
        RepoWsl = $repoWsl
    }
}

function Invoke-WslCommand {
    param(
        [Parameter(Mandatory = $true)][string]$RepoWsl,
        [Parameter(Mandatory = $true)][string]$Command,
        [switch]$IgnoreExitCode
    )

    $output = & wsl.exe -d $Distro --cd $RepoWsl bash -lc $Command 2>&1
    $code = $LASTEXITCODE
    if ($output) {
        foreach ($line in $output) {
            Write-Host $line
        }
    }
    if (-not $IgnoreExitCode -and $code -ne 0) {
        throw "WSL command failed ($code): $Command"
    }
    return $code
}

Assert-WslAvailable
$paths = Get-RepoPaths
$repoWin = $paths.RepoWin
$repoWsl = $paths.RepoWsl

$installedCode = Invoke-WslCommand -RepoWsl $repoWsl -Command "systemctl --user cat auto-company.service >/dev/null 2>&1" -IgnoreExitCode
if ($installedCode -eq 0) {
    $stopCode = Invoke-WslCommand -RepoWsl $repoWsl -Command "systemctl --user stop auto-company.service" -IgnoreExitCode
    if ($stopCode -ne 0) {
        Write-Warning "auto-company.service is installed but was not running/loaded."
    } else {
        Write-Host "WSL daemon stopped: auto-company.service"
    }
} else {
    Write-Warning "auto-company.service is not installed. Falling back to foreground stop."
    $null = Invoke-WslCommand -RepoWsl $repoWsl -Command "make stop" -IgnoreExitCode
}

$awakeScript = Join-Path $repoWin "scripts\\windows\\awake-guardian-win.ps1"
if (Test-Path $awakeScript) {
    & $awakeScript -Action stop
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Awake guardian reported a non-zero exit while stopping."
    }
}

exit 0
