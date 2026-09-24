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

function Get-RepoPaths {
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
        throw (Get-AutoCompanyMessage -Key 'WSL command failed ({0}): {1}' -Values @($code, $Command))
    }
    return $code
}

Assert-WslAvailable
$paths = Get-RepoPaths
$repoWin = $paths.RepoWin
$repoWsl = $paths.RepoWsl

$pendingFile = Join-Path $repoWin ".auto-loop-stop-pending"
[System.IO.File]::WriteAllText($pendingFile, "stopping`n")
$stopFailed = $false
try {
    $installedCode = Invoke-WslCommand -RepoWsl $repoWsl -Command "systemctl --user cat auto-company.service >/dev/null 2>&1" -IgnoreExitCode
    if ($installedCode -eq 0) {
        $null = Invoke-WslCommand -RepoWsl $repoWsl -Command "bash scripts/wsl/dashboard-wsl.sh stop"
        Write-Host (Get-AutoCompanyMessage -Key 'WSL daemon stopped: auto-company.service')
    } else {
        $null = Invoke-WslCommand -RepoWsl $repoWsl -Command "bash scripts/core/stop-loop.sh --wait"
    }
} catch {
    $stopFailed = $true
    Write-Warning $_
}

# Attempt both owned helpers even when the daemon stop failed.
foreach ($helper in @('awake-guardian-win.ps1', 'wsl-anchor-win.ps1')) {
    try {
        $helperPath = Join-Path $PSScriptRoot $helper
        $helperArgs = @{ Action = 'stop'; Language = $script:AutoCompanyMessageLanguage }
        if ($helper -eq 'wsl-anchor-win.ps1') {
            $helperArgs.Distro = $Distro
            $helperArgs.RepoWsl = $repoWsl
        }
        & $helperPath @helperArgs
        if ($LASTEXITCODE -ne 0) { throw "$helper cleanup returned $LASTEXITCODE." }
    } catch {
        $stopFailed = $true
        Write-Warning $_
    }
}
if ($stopFailed) {
    Write-Warning "Stop cleanup is incomplete. Review the errors and retry Stop."
    exit 1
}
Remove-Item -LiteralPath $pendingFile -ErrorAction Stop
exit 0
