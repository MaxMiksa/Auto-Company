# Keep executable PowerShell ASCII for Windows PowerShell 5.1. The UTF-8 TSV
# catalog is shared with the Python-free POSIX bootstrap.
[CmdletBinding()]
param(
    [string]$Target,
    [string]$Source,
    [string]$Language,
    [string]$Engine,
    [string]$Distro,
    [switch]$Media,
    [switch]$SkipMedia,
    [switch]$Login,
    [switch]$Yes,
    [switch]$Plan,
    [switch]$NoDashboard,
    [switch]$Help
)

$script:BootstrapLanguage = 'en'
$script:BootstrapCatalog = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot 'bootstrap-messages.tsv'), [Text.Encoding]::UTF8)) {
    $parts = $line.Split([char]9)
    if ($parts.Count -eq 3) { $script:BootstrapCatalog[$parts[0]] = @($parts[1], $parts[2]) }
}

function Get-BootstrapMessage {
    param([string]$Key, [object[]]$Values = @())
    if (-not $script:BootstrapCatalog.ContainsKey($Key)) { return "[$Key]" }
    $index = 0
    if ($script:BootstrapLanguage -eq 'zh-CN') { $index = 1 }
    $template = $script:BootstrapCatalog[$Key][$index]
    # A MatchEvaluator avoids reinterpreting replacement metacharacters.
    return [regex]::Replace($template, '\{([0-9]+)\}', {
        param($match)
        $number = [int]$match.Groups[1].Value
        if ($number -lt $Values.Count) { return [string]$Values[$number] }
        return $match.Value
    }.GetNewClosure())
}

function Write-BootstrapMessage {
    param([string]$Key, [object[]]$Values = @())
    Write-Host (Get-BootstrapMessage $Key $Values)
}

function Get-BootstrapSystemLanguage {
    try {
        if (-not ('AutoCompany.SetupNative' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace AutoCompany {
    public static class SetupNative {
        [DllImport("kernel32.dll")]
        public static extern ushort GetUserDefaultUILanguage();
    }
}
'@
        }
        $id = [AutoCompany.SetupNative]::GetUserDefaultUILanguage()
        $name = [Globalization.CultureInfo]::GetCultureInfo([int]$id).Name
        if ($name -imatch '^zh(?:-|$)') { return 'zh-CN' }
    } catch { }
    return 'en'
}

function Assert-BootstrapValue {
    param([string]$Value)
    if ($Value -match '[\r\n\t]') { throw (Get-BootstrapMessage 'path_invalid') }
}

function Get-BootstrapState {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse' }
        $state = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($state.schema -ne 1 -or $state.language -notin @('zh-CN', 'en') -or
            $state.engine -notin @('claude', 'codex') -or $state.media -isnot [bool]) { throw 'schema' }
        foreach ($value in @($state.target, $state.distro, $state.stage)) { Assert-BootstrapValue ([string]$value) }
        if (-not $state.target -or -not $state.distro) { throw 'missing' }
        return $state
    } catch { throw (Get-BootstrapMessage 'state_invalid' @($Path)) }
}

function Save-BootstrapState {
    param([string]$Path, [hashtable]$State)
    $directory = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw (Get-BootstrapMessage 'state_invalid' @($Path)) }
    }
    $temporary = Join-Path $directory ([IO.Path]::GetRandomFileName())
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporary, ($State | ConvertTo-Json -Depth 5), $encoding)
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Find-BootstrapPython {
    $candidates = @()
    foreach ($name in @('python', 'python3', 'py')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and $command.Source -and $command.Source -notmatch '\\Microsoft\\WindowsApps\\') {
            $prefix = @()
            if ($name -eq 'py') { $prefix = @('-3') }
            $candidates += @{ File = $command.Source; Prefix = $prefix }
        }
    }
    if ($env:LOCALAPPDATA) {
        $known = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python312/python.exe'
        if (Test-Path -LiteralPath $known) { $candidates += @{ File = $known; Prefix = @() } }
    }
    foreach ($candidate in $candidates) {
        $arguments = @($candidate.Prefix) + @('-c', 'import sys; sys.exit(sys.version_info < (3, 10))')
        try {
            & $candidate.File @arguments 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}

function Get-BootstrapDistros {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return @() }
    try {
        $output = & wsl.exe --list --quiet 2>$null
        if ($LASTEXITCODE -ne 0) { return @() }
        return @($output | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() } | Where-Object { $_ })
    } catch { return @() }
}

function Test-BootstrapWsl2 {
    param([string]$SelectedDistro)
    try {
        $lines = & wsl.exe --list --verbose 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        foreach ($line in $lines) {
            $text = ([string]$line).Replace([string][char]0, '').Trim()
            # Header/state text is localized. Only distro and version are data.
            if ($text -match ('^\*?\s*' + [regex]::Escape($SelectedDistro) + '\s+.+\s+2\s*$')) { return $true }
        }
    } catch { }
    return $false
}

function ConvertTo-BootstrapWslPath {
    param([string]$Path, [string]$SelectedDistro)
    $converted = & wsl.exe -d $SelectedDistro --exec wslpath -a ($Path.Replace('\', '/'))
    if ($LASTEXITCODE -ne 0 -or -not $converted) { throw (Get-BootstrapMessage 'shared_path') }
    $result = ($converted -join '').Trim()
    Assert-BootstrapValue $result
    if (-not $result.StartsWith('/')) { throw (Get-BootstrapMessage 'shared_path') }
    return $result
}

function Invoke-BootstrapWsl {
    param([string]$SelectedDistro, [string]$BootstrapPath, [string[]]$Arguments)
    # Forward argv without building a shell command, preserving spaces, quotes,
    # dollar signs, and non-ASCII directory names on both PowerShell editions.
    & wsl.exe -d $SelectedDistro --exec bash -l $BootstrapPath @Arguments | Out-Host
    return $LASTEXITCODE
}

function Invoke-BootstrapWslInstall {
    param([string]$SelectedDistro)
    # Distro is validated before entering a Windows command-line argument list.
    if ($SelectedDistro -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
        throw (Get-BootstrapMessage 'invalid' @($SelectedDistro))
    }
    $process = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install', '-d', $SelectedDistro, '--no-launch') -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    return $process.ExitCode
}

function Invoke-BootstrapMain {
    param([hashtable]$Options)
    $script:BootstrapLanguage = Get-BootstrapSystemLanguage
    if ($Options.Language -ieq 'en') { $Options.Language = 'en'; $script:BootstrapLanguage = 'en' }
    elseif ($Options.Language -ieq 'zh-CN') { $Options.Language = 'zh-CN'; $script:BootstrapLanguage = 'zh-CN' }
    $stage = Get-BootstrapMessage 'stage_inspect'
    try {
        if ($env:OS -ne 'Windows_NT') { throw (Get-BootstrapMessage 'windows_only') }
        if ($Options.Help) { Write-BootstrapMessage 'help_windows'; return 0 }
        foreach ($key in @('Target', 'Source', 'Language', 'Engine', 'Distro')) { Assert-BootstrapValue ([string]$Options[$key]) }
        if ($Options.Language -and $Options.Language -notin @('en', 'zh-CN')) { throw (Get-BootstrapMessage 'invalid' @($Options.Language)) }
        if (-not $env:LOCALAPPDATA) { throw (Get-BootstrapMessage 'invalid' @('LOCALAPPDATA')) }
        $statePath = Join-Path $env:LOCALAPPDATA 'AutoCompany/setup-state.json'
        $saved = Get-BootstrapState $statePath
        if ($saved -and -not $Options.Language) { $script:BootstrapLanguage = $saved.language }
        $stage = Get-BootstrapMessage 'stage_inspect'
        if (-not $Options.Target) {
            if ($saved) { $Options.Target = $saved.target }
            else { $Options.Target = Join-Path $env:USERPROFILE 'Auto-Company' }
        }
        if (-not $Options.Source) { $Options.Source = Join-Path $PSScriptRoot '../..' }
        $Options.Target = [IO.Path]::GetFullPath($Options.Target)
        $Options.Source = [IO.Path]::GetFullPath($Options.Source)
        foreach ($path in @($Options.Target, $Options.Source)) {
            if ($path -notmatch '^[A-Za-z]:\\' -or $path.StartsWith('\\')) { throw (Get-BootstrapMessage 'shared_path') }
            $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($path))
            if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw (Get-BootstrapMessage 'shared_path') }
        }
        if (-not $Options.Language -and -not $saved) {
            $preference = Join-Path $Options.Target '.auto-company.local'
            if (Test-Path -LiteralPath $preference) {
                if ((Get-Item -LiteralPath $preference -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw (Get-BootstrapMessage 'state_invalid' @($preference)) }
                foreach ($line in [IO.File]::ReadAllLines($preference, [Text.Encoding]::UTF8)) {
                    if ($line -cmatch '^AUTO_COMPANY_LANGUAGE=(en|zh-CN)$') { $script:BootstrapLanguage = $Matches[1] }
                }
            }
        }
        $stage = Get-BootstrapMessage 'stage_inspect'
        if (-not (Test-Path -LiteralPath (Join-Path $Options.Source 'release-files.json'))) { throw (Get-BootstrapMessage 'payload_missing') }
        if (-not $Options.Engine -and $saved) { $Options.Engine = $saved.engine }
        if (-not $Options.Engine) {
            $Options.Engine = 'claude'
            if (-not $Options.Plan -and -not $Options.Yes -and -not [Console]::IsInputRedirected) {
                $selection = Read-Host (Get-BootstrapMessage 'engine_choice')
                if ($selection -eq '2') { $Options.Engine = 'codex' }
                elseif ($selection -notin @('', '1')) { throw (Get-BootstrapMessage 'invalid' @($selection)) }
            }
        }
        if ($Options.Engine -notin @('claude', 'codex')) { throw (Get-BootstrapMessage 'invalid' @($Options.Engine)) }
        $Options.Engine = $Options.Engine.ToLowerInvariant()
        if ($Options.Media -and $Options.SkipMedia) { throw (Get-BootstrapMessage 'invalid' @('-Media / -SkipMedia')) }
        if ($Options.SkipMedia) { $Options.Media = $false }
        elseif ($saved -and -not $Options.ContainsKey('Media')) { $Options.Media = [bool]$saved.media }
        $distros = @(Get-BootstrapDistros)
        if (-not $Options.Distro -and $saved) { $Options.Distro = $saved.distro }
        if (-not $Options.Distro) {
            if ($distros.Count -eq 0) { $Options.Distro = 'Ubuntu-24.04' }
            elseif ($distros.Count -eq 1) { $Options.Distro = $distros[0] }
            else {
                Write-BootstrapMessage 'distro_choice'
                for ($i = 0; $i -lt $distros.Count; $i++) { Write-Host ('  {0}. {1}' -f ($i + 1), $distros[$i]) }
                if ([Console]::IsInputRedirected -or $Options.Plan -or $Options.Yes) { throw (Get-BootstrapMessage 'distro_required') }
                $selection = Read-Host
                $number = 0
                if (-not [int]::TryParse($selection, [ref]$number) -or $number -lt 1 -or $number -gt $distros.Count) { throw (Get-BootstrapMessage 'invalid' @($selection)) }
                $Options.Distro = $distros[$number - 1]
            }
        }
        Assert-BootstrapValue $Options.Distro
        $python = Find-BootstrapPython
        $needWsl = $Options.Distro -notin $distros
        Write-BootstrapMessage 'title'
        Write-BootstrapMessage 'plan' @('Windows', $script:BootstrapLanguage, $Options.Engine)
        Write-BootstrapMessage 'target' @($Options.Target)
        Write-BootstrapMessage 'source' @($Options.Source)
        Write-BootstrapMessage 'distro' @($Options.Distro)
        if ($python) { Write-BootstrapMessage 'reuse' @('Windows Python 3.10+') }
        else { Write-BootstrapMessage 'windows_python' }
        $arguments = @('--source', '', '--target', '', '--language', $script:BootstrapLanguage, '--engine', $Options.Engine, '--distro', $Options.Distro, '--wsl-runtime')
        if ($Options.Media) { $arguments += '--media' }
        else { $arguments += '--skip-media' }
        if ($Options.Login) { $arguments += '--login' }
        $runtimeReady = $false
        if ($needWsl) {
            Write-BootstrapMessage 'wsl_plan' @($Options.Distro)
            Write-BootstrapMessage 'wsl_deferred'
            Write-BootstrapMessage 'service_plan'
        } else {
            if (-not (Test-BootstrapWsl2 $Options.Distro)) { throw (Get-BootstrapMessage 'wsl2_needed' @($Options.Distro)) }
            $uid = & wsl.exe -d $Options.Distro --exec id -u 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $uid -or ($uid -join '').Trim() -eq '0') {
                Write-BootstrapMessage 'wsl_user' @($Options.Distro)
            } else {
                $arguments[1] = ConvertTo-BootstrapWslPath $Options.Source $Options.Distro
                $arguments[3] = ConvertTo-BootstrapWslPath $Options.Target $Options.Distro
                $bootstrapPath = $arguments[1] + '/scripts/install/bootstrap.sh'
                $result = Invoke-BootstrapWsl $Options.Distro $bootstrapPath ($arguments + '--plan')
                if ($result -ne 0) { return $result }
                $runtimeReady = $true
            }
        }
        if ($Options.Plan) { return 0 }
        if (-not $Options.Yes) {
            $answer = Read-Host (Get-BootstrapMessage 'confirm')
            if ($answer -notin @('y', 'yes')) { Write-BootstrapMessage 'cancelled'; return 0 }
        }
        $state = @{ schema = 1; language = $script:BootstrapLanguage; target = $Options.Target; engine = $Options.Engine; distro = $Options.Distro; media = [bool]$Options.Media; stage = 'dependencies' }
        Save-BootstrapState $statePath $state
        $stage = Get-BootstrapMessage 'stage_dependencies'
        if ($needWsl) {
            if ([Environment]::OSVersion.Version.Build -lt 22000) { throw (Get-BootstrapMessage 'windows_baseline') }
            $result = Invoke-BootstrapWslInstall $Options.Distro
            if ($result -notin @(0, 3010, 1641)) { throw (Get-BootstrapMessage 'failed' @('WSL')) }
            $state.stage = 'reboot-or-user'
            Save-BootstrapState $statePath $state
            Write-BootstrapMessage 'reboot'
            Write-BootstrapMessage 'resume' @($statePath)
            return 3010
        }
        if (-not $runtimeReady) {
            $state.stage = 'linux-user'
            Save-BootstrapState $statePath $state
            Write-BootstrapMessage 'resume' @($statePath)
            return 20
        }
        if (-not $python) {
            if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw (Get-BootstrapMessage 'winget_missing') }
            Write-BootstrapMessage 'diagnostics'
            & winget.exe install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements | Out-Host
            if ($LASTEXITCODE -ne 0) { throw (Get-BootstrapMessage 'failed' @('Windows Python')) }
            $python = Find-BootstrapPython
            if (-not $python) { throw (Get-BootstrapMessage 'winget_missing') }
        }
        $result = Invoke-BootstrapWsl $Options.Distro $bootstrapPath ($arguments + '--yes')
        if ($result -ne 0) { Write-BootstrapMessage 'resume' @($statePath); return $result }
        $state.stage = 'complete'
        Save-BootstrapState $statePath $state
        Write-BootstrapMessage 'core_ready' @($Options.Target)
        if (-not $Options.NoDashboard) {
            $stage = Get-BootstrapMessage 'stage_dashboard'
            Write-BootstrapMessage 'dashboard' @('http://127.0.0.1:8787/')
            $pythonArgs = @($python.Prefix) + @((Join-Path $Options.Target 'dashboard/server.py'), '--host', '127.0.0.1', '--port', '8787', '--open-browser')
            & $python.File @pythonArgs | Out-Host
            return $LASTEXITCODE
        }
        Write-BootstrapMessage 'dashboard_later' @(Join-Path $Options.Target 'scripts/windows/dashboard-win.ps1')
        return 0
    } catch {
        Write-BootstrapMessage 'failed' @($stage)
        Write-Host $_.Exception.Message
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    exit (Invoke-BootstrapMain $PSBoundParameters)
}
