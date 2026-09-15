param(
    [ValidateSet("start", "stop", "status", "run")]
    [string]$Action = "status",
    [string]$Distro = "Ubuntu",
    [string]$RepoWsl = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "wsl.exe not found. Enable WSL first."
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
        throw "Failed to convert repository path to WSL path."
    }
    $repoWsl = $repoWslRaw.Trim()
    if (-not $repoWsl) {
        throw "Failed to convert repository path to WSL path."
    }
    return $repoWsl
}

function Get-RunningAnchorProcess {
    if (-not (Test-Path $pidFile)) {
        return $null
    }

    $pidText = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
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
    if ($cmd -and $cmd -match "wsl-anchor-win\.ps1" -and $cmd -match "-Action\s+run") {
        return $proc
    }
    return $null
}

function Clear-StateFiles {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Remove-Item $stopFile -ErrorAction SilentlyContinue
}

switch ($Action) {
    "start" {
        $existing = Get-RunningAnchorProcess
        if ($existing) {
            Write-Output "WSL anchor: RUNNING (PID $($existing.Id))"
            exit 0
        }

        $resolvedRepoWsl = Resolve-RepoWslPath -RawRepoWsl $RepoWsl
        Remove-Item $stopFile -ErrorAction SilentlyContinue
        $selfPath = $PSCommandPath

        $proc = Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $selfPath,
            "-Action", "run",
            "-Distro", $Distro,
            "-RepoWsl", $resolvedRepoWsl
        )

        for ($i = 0; $i -lt 25; $i++) {
            Start-Sleep -Milliseconds 200
            $running = Get-RunningAnchorProcess
            if ($running) {
                Write-Output "WSL anchor started (PID $($running.Id))."
                exit 0
            }
        }

        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Error "Failed to start WSL anchor."
        exit 1
    }

    "run" {
        $resolvedRepoWsl = Resolve-RepoWslPath -RawRepoWsl $RepoWsl
        [System.IO.File]::WriteAllText($pidFile, "$PID`n", $utf8NoBom)
        Remove-Item $stopFile -ErrorAction SilentlyContinue

        try {
            while (-not (Test-Path $stopFile)) {
                & wsl.exe -d $Distro --cd $resolvedRepoWsl bash -lc "while true; do sleep 3600; done" | Out-Null
                if (Test-Path $stopFile) {
                    break
                }
                Start-Sleep -Seconds 2
            }
        }
        finally {
            Clear-StateFiles
        }
        exit 0
    }

    "stop" {
        $existing = Get-RunningAnchorProcess
        if (-not $existing) {
            Clear-StateFiles
            Write-Output "WSL anchor is not running."
            exit 0
        }

        [System.IO.File]::WriteAllText($stopFile, "1`n", $utf8NoBom)
        Start-Sleep -Milliseconds 500
        if (-not $existing.HasExited) {
            Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
        }
        Clear-StateFiles
        Write-Output "WSL anchor stopped."
        exit 0
    }

    "status" {
        $existing = Get-RunningAnchorProcess
        if ($existing) {
            Write-Output "WSL anchor: RUNNING (PID $($existing.Id))"
        } else {
            Write-Output "WSL anchor: STOPPED"
        }
        exit 0
    }
}
