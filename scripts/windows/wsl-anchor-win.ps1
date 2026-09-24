param(
    [ValidateSet("start", "stop", "status", "run")]
    [string]$Action = "status",
    [string]$Distro = "Ubuntu",
    [string]$RepoWsl = "",
    [string]$Token = "",
    [ValidateSet("zh-CN", "en")][string]$Language
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "messages-win.ps1")
if (-not $PSBoundParameters.ContainsKey("Distro")) { $Distro = Resolve-AutoCompanyDistro }
if ($PSBoundParameters.ContainsKey("Language")) { Initialize-AutoCompanyMessages -Language $Language }
if ($Action -in @('start', 'run')) { Assert-AutoCompanyMaintenance }

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw (Get-AutoCompanyMessage -Key 'wsl.exe not found. Enable WSL first.')
}

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$pidFile = Join-Path $repoWin ".auto-loop-wsl-anchor.pid"
$stopFile = Join-Path $repoWin ".auto-loop-wsl-anchor.stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-RepoWslPath {
    param([string]$RawRepoWsl)

    if ($RawRepoWsl) {
        return $RawRepoWsl
    }

    $repoWinForWsl = $repoWin -replace "\\", "/"
    $repoWslRaw = & wsl.exe -d $Distro wslpath -a "$repoWinForWsl"
    if (-not $repoWslRaw) {
        throw (Get-AutoCompanyMessage -Key 'Failed to convert repository path to WSL path.')
    }
    $repoWsl = $repoWslRaw.Trim()
    if (-not $repoWsl) {
        throw (Get-AutoCompanyMessage -Key 'Failed to convert repository path to WSL path.')
    }
    return $repoWsl
}

function Get-RunningAnchorProcess {
    if (-not (Test-Path $pidFile)) {
        return $null
    }

    $pidText = [string](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $pidText = $pidText.Trim()
    if (-not $pidText) {
        return $null
    }

    $pidValue = 0
    if (-not [int]::TryParse($pidText, [ref]$pidValue)) {
        return $null
    }

    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (-not $proc) {
        return $null
    }

    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue).CommandLine
    if ($cmd -and $cmd -match ('(?:^|\s)-File\s+"?' + [regex]::Escape($PSCommandPath) + '"?(?=\s|$)') -and $cmd -match "-Action\s+run") {
        return $proc
    }
    return $null
}

function Invoke-LinuxAnchor {
    param([string]$Operation, [string]$RunToken = "")
    $resolved = Resolve-RepoWslPath -RawRepoWsl $RepoWsl
    $helper = "$resolved/scripts/wsl/anchor.py"
    & wsl.exe -d $Distro --cd $resolved -e python3 $helper $Operation $RunToken
    if ($LASTEXITCODE -ne 0) { throw "WSL anchor $Operation could not be confirmed." }
}

function Clear-StateFiles {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Remove-Item $stopFile -ErrorAction SilentlyContinue
}

switch ($Action) {
    "start" {
        $linuxState = Invoke-LinuxAnchor -Operation status
        $existing = Get-RunningAnchorProcess
        if ($existing -or $linuxState -match "Linux: RUNNING") {
            Write-Output "WSL anchor: RUNNING (PID $($existing.Id))"
            exit 0
        }

        # Recover an orphaned Linux keeper before creating a new generation.
        Invoke-LinuxAnchor -Operation stop
        $resolvedRepoWsl = Resolve-RepoWslPath -RawRepoWsl $RepoWsl
        Remove-Item $stopFile -ErrorAction SilentlyContinue
        $selfPath = $PSCommandPath

        $proc = Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", ('"' + $selfPath + '"'),
            "-Action", "run",
            "-Distro", $Distro,
            "-RepoWsl", ('"' + $resolvedRepoWsl + '"'),
            "-Token", ([guid]::NewGuid().ToString("N"))
        )

        for ($i = 0; $i -lt 25; $i++) {
            Start-Sleep -Milliseconds 200
            $running = Get-RunningAnchorProcess
            if ($running -and ((Invoke-LinuxAnchor -Operation status) -match "Linux: RUNNING")) {
                Write-Output (Get-AutoCompanyMessage -Key 'WSL anchor started (PID {0}).' -Values @($running.Id))
                exit 0
            }
        }

        Invoke-LinuxAnchor -Operation stop
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Error (Get-AutoCompanyMessage -Key 'Failed to start WSL anchor.')
        exit 1
    }

    "run" {
        $resolvedRepoWsl = Resolve-RepoWslPath -RawRepoWsl $RepoWsl
        [System.IO.File]::WriteAllText($pidFile, "$PID`n", $utf8NoBom)
        Remove-Item $stopFile -ErrorAction SilentlyContinue

        try {
            if (-not $Token) { throw "WSL anchor run requires an ownership token." }
            Invoke-LinuxAnchor -Operation run -RunToken $Token
        }
        finally {
            # The stop caller clears the marker only after Linux exit is verified.
            Remove-Item $pidFile -ErrorAction SilentlyContinue
        }
        exit 0
    }

    "stop" {
        [System.IO.File]::WriteAllText($stopFile, "1`n", $utf8NoBom)
        Invoke-LinuxAnchor -Operation stop
        $existing = Get-RunningAnchorProcess
        if ($existing -and -not $existing.WaitForExit(3000)) {
            # Linux is already confirmed gone. Only our exact wrapper is eligible.
            $owned = Get-RunningAnchorProcess
            if ($owned -and $owned.StartTime -eq $existing.StartTime) {
                Stop-Process -InputObject $owned -Force
                if (-not $owned.WaitForExit(3000)) { throw "WSL anchor wrapper cleanup is incomplete." }
            }
        }
        if (Get-RunningAnchorProcess) { throw "WSL anchor wrapper is still running." }
        Clear-StateFiles
        Write-Output (Get-AutoCompanyMessage -Key 'WSL anchor stopped.')
        exit 0
    }

    "status" {
        $linuxState = Invoke-LinuxAnchor -Operation status
        $existing = Get-RunningAnchorProcess
        if ($existing -or $linuxState -match "Linux: RUNNING") {
            Write-Output "WSL anchor: RUNNING (PID $($existing.Id))"
        } else {
            Write-Output "WSL anchor: STOPPED"
        }
        exit 0
    }
}
