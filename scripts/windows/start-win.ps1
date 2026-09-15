param(
    [string]$Distro = "Ubuntu",
    [string]$Engine,
    [string]$Model,
    [string]$ClaudePermissionMode,
    [string]$ClaudeBin,
    [string]$CodexBin,
    [string]$CursorBin,
    [switch]$EnableCursorAdapter,
    [ValidateSet("enabled", "disabled")][string]$CursorSandboxMode,
    [switch]$CursorForce,
    [switch]$CursorAllowUnsandboxed,
    [switch]$EnableOpenAICompatibleAdapter,
    [string]$OpenAICompatibleEndpoint,
    [string]$OpenAICompatibleModel,
    [switch]$OpenAICompatibleAllowShell,
    [switch]$OpenAICompatibleAllowInsecureHttp,
    [int]$LoopInterval,
    [int]$CycleTimeoutSeconds,
    [int]$MaxConsecutiveErrors,
    [int]$CooldownSeconds,
    [int]$LimitWaitSeconds,
    [int]$MaxLogs,
    [string]$SandboxMode,
    [string]$CodexSandboxMode
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
    $repoWslRaw = & wsl.exe -d $Distro wslpath -a "$repoWinForWsl"
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

function Write-AutoLoopEnv {
    param(
        [Parameter(Mandatory = $true)][string]$RepoWin,
        [string[]]$EnvLines = @()
    )

    $envFile = Join-Path $RepoWin ".auto-loop.env"
    if ((Test-Path $envFile) -and $EnvLines.Count -eq 0) {
        Write-Host "Reusing env file: $envFile"
        return
    }
    $updates = @{}
    foreach ($entry in $EnvLines) {
        if ($entry -match '[\r\n]') { throw "Environment values must be a single line." }
        $key, $value = $entry -split '=', 2
        # systemd EnvironmentFile quoting, not shell evaluation.
        $updates[$key] = $key + '="' + $value.Replace('\', '\\').Replace('"', '\"') + '"'
    }
    $lines = @()
    if (Test-Path $envFile) {
        foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
            # -cmatch, not -match: -match is case-insensitive using the current
            # culture, and under tr-TR "I" lower-cases to U+0131, which is
            # outside [A-Za-z]. Every key holding an "I" would then fail to
            # match and be appended again on each run. Env keys are
            # case-sensitive anyway.
            if ($line -cmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
                $key = $Matches[1]
                if ($updates.ContainsKey($key)) { continue }
            }
            $lines += $line
        }
    } else {
        $lines += '# Auto Company systemd environment'
    }
    foreach ($key in ($updates.Keys | Sort-Object)) { $lines += $updates[$key] }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($envFile, $lines, $utf8NoBom)
    Write-Host "Wrote env file: $envFile"
}

function Start-AutoCompanyService {
    param(
        [Parameter(Mandatory = $true)][string]$RepoWin,
        [Parameter(Mandatory = $true)][string]$RepoWsl,
        [string[]]$EnvLines = @()
    )

    $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "command -v systemctl >/dev/null 2>&1 && systemctl --user --version >/dev/null 2>&1"
    $installedCode = Invoke-WslCommand -RepoWsl $RepoWsl -Command "systemctl --user cat auto-company.service >/dev/null 2>&1" -IgnoreExitCode
    if ($installedCode -eq 0) {
        # Existing services must belong here before changing any local config.
        $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "bash scripts/wsl/dashboard-wsl.sh check"
    }
    # An installer may enable/start immediately, so persist chosen settings first.
    Write-AutoLoopEnv -RepoWin $RepoWin -EnvLines $EnvLines
    if ($installedCode -ne 0) {
        Write-Host "auto-company.service not installed; running make install..."
        $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "make install"
    }
    $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "bash scripts/wsl/dashboard-wsl.sh start"
}

Assert-WslAvailable
$paths = Get-RepoPaths
$repoWin = $paths.RepoWin
$repoWsl = $paths.RepoWsl

if ($PSBoundParameters.ContainsKey("Engine")) {
    $engineNormalized = $Engine.ToLowerInvariant()
    if ($engineNormalized -notin @("claude", "codex", "cursor", "openai-compatible")) {
        throw "Unsupported Engine '$Engine'. Use claude, codex, cursor, or openai-compatible."
    }
    $Engine = $engineNormalized
}

if ($Engine -eq "cursor" -and -not $EnableCursorAdapter) {
    throw "Engine cursor requires -EnableCursorAdapter."
}
if ($Engine -eq "openai-compatible") {
    if (-not $EnableOpenAICompatibleAdapter) {
        throw "Engine openai-compatible requires -EnableOpenAICompatibleAdapter."
    }
    if (-not $OpenAICompatibleEndpoint -or -not $OpenAICompatibleModel) {
        throw "Engine openai-compatible requires -OpenAICompatibleEndpoint and -OpenAICompatibleModel."
    }
    if ($OpenAICompatibleEndpoint -match "[?#]" -or $OpenAICompatibleEndpoint -match "://[^/]*@") {
        throw "OpenAICompatibleEndpoint must not contain a query, fragment, or embedded credentials."
    }
    $adapterSecret = [Environment]::GetEnvironmentVariable("OPENAI_COMPATIBLE_API_KEY")
    if ($adapterSecret -and ($OpenAICompatibleEndpoint.Contains($adapterSecret) -or $OpenAICompatibleModel.Contains($adapterSecret))) {
        throw "API key material must not be embedded in endpoint or model configuration."
    }
}

if ($PSBoundParameters.ContainsKey("CycleTimeoutSeconds") -and $CycleTimeoutSeconds -lt 300) {
    Write-Warning "CycleTimeoutSeconds=$CycleTimeoutSeconds is very low for real cycles and may cause frequent timeouts. Recommended: 900-1800."
}

$envLines = @()
if ($PSBoundParameters.ContainsKey("Engine")) { $envLines += "ENGINE=$Engine" }
if ($PSBoundParameters.ContainsKey("Model")) { $envLines += "MODEL=$Model" }
if ($PSBoundParameters.ContainsKey("ClaudePermissionMode")) { $envLines += "CLAUDE_PERMISSION_MODE=$ClaudePermissionMode" }
if ($PSBoundParameters.ContainsKey("ClaudeBin")) { $envLines += "CLAUDE_BIN=$ClaudeBin" }
if ($PSBoundParameters.ContainsKey("CodexBin")) { $envLines += "CODEX_BIN=$CodexBin" }
if ($PSBoundParameters.ContainsKey("CursorBin")) { $envLines += "CURSOR_BIN=$CursorBin" }
if ($EnableCursorAdapter) { $envLines += "CURSOR_ADAPTER_ENABLED=1" }
if ($PSBoundParameters.ContainsKey("CursorSandboxMode")) { $envLines += "CURSOR_SANDBOX_MODE=$CursorSandboxMode" }
if ($CursorForce) { $envLines += "CURSOR_FORCE=1" }
if ($CursorAllowUnsandboxed) { $envLines += "CURSOR_ALLOW_UNSANDBOXED=1" }
if ($EnableOpenAICompatibleAdapter) { $envLines += "OPENAI_COMPATIBLE_ADAPTER_ENABLED=1" }
if ($PSBoundParameters.ContainsKey("OpenAICompatibleEndpoint")) { $envLines += "OPENAI_COMPATIBLE_ENDPOINT=$OpenAICompatibleEndpoint" }
if ($PSBoundParameters.ContainsKey("OpenAICompatibleModel")) { $envLines += "OPENAI_COMPATIBLE_MODEL=$OpenAICompatibleModel" }
if ($OpenAICompatibleAllowShell) { $envLines += "OPENAI_COMPATIBLE_ALLOW_SHELL=1" }
if ($OpenAICompatibleAllowInsecureHttp) { $envLines += "OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1" }
if ($PSBoundParameters.ContainsKey("LoopInterval")) { $envLines += "LOOP_INTERVAL=$LoopInterval" }
if ($PSBoundParameters.ContainsKey("CycleTimeoutSeconds")) { $envLines += "CYCLE_TIMEOUT_SECONDS=$CycleTimeoutSeconds" }
if ($PSBoundParameters.ContainsKey("MaxConsecutiveErrors")) { $envLines += "MAX_CONSECUTIVE_ERRORS=$MaxConsecutiveErrors" }
if ($PSBoundParameters.ContainsKey("CooldownSeconds")) { $envLines += "COOLDOWN_SECONDS=$CooldownSeconds" }
if ($PSBoundParameters.ContainsKey("LimitWaitSeconds")) { $envLines += "LIMIT_WAIT_SECONDS=$LimitWaitSeconds" }
if ($PSBoundParameters.ContainsKey("MaxLogs")) { $envLines += "MAX_LOGS=$MaxLogs" }
if ($PSBoundParameters.ContainsKey("SandboxMode")) {
    $envLines += "CODEX_SANDBOX_MODE=$SandboxMode"
} elseif ($PSBoundParameters.ContainsKey("CodexSandboxMode")) {
    $envLines += "CODEX_SANDBOX_MODE=$CodexSandboxMode"
}

Start-AutoCompanyService -RepoWin $repoWin -RepoWsl $repoWsl -EnvLines $envLines
Write-Host "WSL daemon started: auto-company.service"

$awakeScript = Join-Path $repoWin "scripts\\windows\\awake-guardian-win.ps1"
if (-not (Test-Path $awakeScript)) {
    throw "Missing awake guardian script: $awakeScript"
}

& $awakeScript -Action start
if ($LASTEXITCODE -ne 0) {
    Write-Error "Daemon started, but awake guardian failed to start. System sleep is not protected."
    exit 2
}

$anchorScript = Join-Path $repoWin "scripts\\windows\\wsl-anchor-win.ps1"
if (-not (Test-Path $anchorScript)) {
    throw "Missing WSL anchor script: $anchorScript"
}

& $anchorScript -Action start -Distro $Distro -RepoWsl $repoWsl
if ($LASTEXITCODE -ne 0) {
    Write-Error "Daemon started, but WSL anchor failed to start. Background persistence may be unstable."
    exit 3
}

Write-Host ""
Write-Host "Use .\scripts\windows\status-win.ps1 to inspect daemon and loop status."
exit 0
