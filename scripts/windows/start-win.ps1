param(
    [string]$Distro = "Ubuntu",
    [string]$Engine,
    [string]$Model,
    [ValidateSet("zh-CN", "en")][string]$Language,
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
. (Join-Path $PSScriptRoot "messages-win.ps1")
if (-not $PSBoundParameters.ContainsKey("Distro")) { $Distro = Resolve-AutoCompanyDistro }

function ConvertTo-RuntimeLanguage {
    param([ValidateSet("zh-CN", "en")][string]$Value)
    # PowerShell ValidateSet accepts case variants; the runtime uses canonical tags.
    if ($Value -ieq "en") { return "en" }
    return "zh-CN"
}

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

function Write-AutoLoopEnv {
    param(
        [Parameter(Mandatory = $true)][string]$RepoWin,
        [string[]]$EnvLines = @()
    )

    $envFile = Join-Path $RepoWin ".auto-loop.env"
    if ((Test-Path $envFile) -and $EnvLines.Count -eq 0) {
        Write-Host (Get-AutoCompanyMessage -Key 'Reusing env file: {0}' -Values @($envFile))
        return
    }
    $updates = @{}
    foreach ($entry in $EnvLines) {
        if ($entry -match '[\r\n]') { throw (Get-AutoCompanyMessage -Key 'Environment values must be a single line.') }
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
    Write-Host (Get-AutoCompanyMessage -Key 'Wrote env file: {0}' -Values @($envFile))
}

function Start-AutoCompanyService {
    param(
        [Parameter(Mandatory = $true)][string]$RepoWin,
        [Parameter(Mandatory = $true)][string]$RepoWsl,
        [string[]]$EnvLines = @(),
        [ValidateSet("zh-CN", "en")][string]$Language
    )

    $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "command -v systemctl >/dev/null 2>&1 && systemctl --user --version >/dev/null 2>&1"
    $installedCode = Invoke-WslCommand -RepoWsl $RepoWsl -Command "systemctl --user cat auto-company.service >/dev/null 2>&1" -IgnoreExitCode
    if ($installedCode -eq 0) {
        # Existing services must belong here before changing any local config.
        $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "bash scripts/wsl/dashboard-wsl.sh check"
    }
    if ($PSBoundParameters.ContainsKey('Language')) {
        $canonicalLanguage = ConvertTo-RuntimeLanguage $Language
        $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "python3 scripts/core/localization.py set --language $canonicalLanguage"
    }
    # A product pin can keep the current language while the saved preference
    # changes for the next product. Reload the shared setting after persistence.
    Initialize-AutoCompanyMessages -RepoRoot $RepoWin
    # An installer may enable/start immediately, so persist chosen settings first.
    Write-AutoLoopEnv -RepoWin $RepoWin -EnvLines $EnvLines
    if ($installedCode -ne 0) {
        Write-Host (Get-AutoCompanyMessage -Key 'auto-company.service not installed; running make install...')
        $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "make install"
    }
    $null = Invoke-WslCommand -RepoWsl $RepoWsl -Command "bash scripts/wsl/dashboard-wsl.sh start"
}

if (Test-Path (Join-Path $PSScriptRoot '../../.auto-loop-stop-pending')) {
    throw "The previous stop is unconfirmed. Retry Stop before starting again."
}

Assert-AutoCompanyMaintenance
Assert-WslAvailable
$paths = Get-RepoPaths
$repoWin = $paths.RepoWin
$repoWsl = $paths.RepoWsl

if ($PSBoundParameters.ContainsKey("Engine")) {
    $engineNormalized = $Engine.ToLowerInvariant()
    if ($engineNormalized -notin @("claude", "codex", "cursor", "openai-compatible")) {
        throw (Get-AutoCompanyMessage -Key 'Unsupported Engine ''{0}''. Use claude, codex, cursor, or openai-compatible.' -Values @($Engine))
    }
    $Engine = $engineNormalized
}

if ($Engine -eq "cursor" -and -not $EnableCursorAdapter) {
    throw (Get-AutoCompanyMessage -Key 'Engine cursor requires -EnableCursorAdapter.')
}
if ($Engine -eq "openai-compatible") {
    if (-not $EnableOpenAICompatibleAdapter) {
        throw (Get-AutoCompanyMessage -Key 'Engine openai-compatible requires -EnableOpenAICompatibleAdapter.')
    }
    if (-not $OpenAICompatibleEndpoint -or -not $OpenAICompatibleModel) {
        throw (Get-AutoCompanyMessage -Key 'Engine openai-compatible requires -OpenAICompatibleEndpoint and -OpenAICompatibleModel.')
    }
    if ($OpenAICompatibleEndpoint -match "[?#]" -or $OpenAICompatibleEndpoint -match "://[^/]*@") {
        throw (Get-AutoCompanyMessage -Key 'OpenAICompatibleEndpoint must not contain a query, fragment, or embedded credentials.')
    }
    $adapterSecret = [Environment]::GetEnvironmentVariable("OPENAI_COMPATIBLE_API_KEY")
    if ($adapterSecret -and ($OpenAICompatibleEndpoint.Contains($adapterSecret) -or $OpenAICompatibleModel.Contains($adapterSecret))) {
        throw (Get-AutoCompanyMessage -Key 'API key material must not be embedded in endpoint or model configuration.')
    }
}

if ($PSBoundParameters.ContainsKey("CycleTimeoutSeconds") -and $CycleTimeoutSeconds -lt 300) {
    Write-Warning (Get-AutoCompanyMessage -Key 'CycleTimeoutSeconds={0} is very low for real cycles and may cause frequent timeouts. Recommended: 900-1800.' -Values @($CycleTimeoutSeconds))
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

$startParameters = @{ RepoWin = $repoWin; RepoWsl = $repoWsl; EnvLines = $envLines }
if ($PSBoundParameters.ContainsKey('Language')) { $startParameters.Language = $Language }
Start-AutoCompanyService @startParameters
Write-Host (Get-AutoCompanyMessage -Key 'WSL daemon started: auto-company.service')

$awakeScript = Join-Path $repoWin "scripts\\windows\\awake-guardian-win.ps1"
if (-not (Test-Path $awakeScript)) {
    throw (Get-AutoCompanyMessage -Key 'Missing awake guardian script: {0}' -Values @($awakeScript))
}

& $awakeScript -Action start -Language $script:AutoCompanyMessageLanguage
if ($LASTEXITCODE -ne 0) {
    Write-Error (Get-AutoCompanyMessage -Key 'Daemon started, but awake guardian failed to start. System sleep is not protected.')
    exit 2
}

$anchorScript = Join-Path $repoWin "scripts\\windows\\wsl-anchor-win.ps1"
if (-not (Test-Path $anchorScript)) {
    throw (Get-AutoCompanyMessage -Key 'Missing WSL anchor script: {0}' -Values @($anchorScript))
}

& $anchorScript -Action start -Distro $Distro -RepoWsl $repoWsl -Language $script:AutoCompanyMessageLanguage
if ($LASTEXITCODE -ne 0) {
    Write-Error (Get-AutoCompanyMessage -Key 'Daemon started, but WSL anchor failed to start. Background persistence may be unstable.')
    exit 3
}

Write-Host ""
Write-Host (Get-AutoCompanyMessage -Key 'Use .\scripts\windows\status-win.ps1 to inspect daemon and loop status.')
exit 0
