$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $root 'scripts/install/bootstrap.ps1')
$script:checks = 0
function Assert-Setup {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
    $script:checks++
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('auto-setup-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$oldLocal = $env:LOCALAPPDATA
$oldProfile = $env:USERPROFILE
$originalSystemLanguage = ${function:Get-BootstrapSystemLanguage}
try {
    $actualLanguage = Get-BootstrapSystemLanguage
    Assert-Setup ($actualLanguage -in @('en', 'zh-CN')) 'Win32 language must be supported before Python exists.'
    $script:BootstrapLanguage = 'zh-CN'
    Assert-Setup ((Get-BootstrapMessage 'cancelled') -match ([char]0x5df2)) 'Cancellation must be localized.'
    $literal = 'C:\path $() {1} & '' quote'
    Assert-Setup ((Get-BootstrapMessage 'target' @($literal)).EndsWith($literal)) 'Message replacement must preserve literal content.'
    $dashboardCommand = 'powershell.exe -NoProfile -File ' + (ConvertTo-BootstrapPowerShellLiteral $literal)
    $parseTokens = $null
    $parseErrors = $null
    $commandAst = [Management.Automation.Language.Parser]::ParseInput($dashboardCommand, [ref]$parseTokens, [ref]$parseErrors)
    $nativeCommand = $commandAst.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)
    Assert-Setup ($parseErrors.Count -eq 0 -and $nativeCommand.CommandElements[-1].Value -eq $literal) 'Dashboard command must preserve a path containing spaces and apostrophes.'
    $env:LOCALAPPDATA = Join-Path $fixture 'local'
    $env:USERPROFILE = Join-Path $fixture 'profile'
    $source = Join-Path $fixture ('payload ' + [char]0x4e2d + ' $ apostrophe''')
    $target = Join-Path $fixture ('stable ' + [char]0x6587 + ' $ apostrophe''')
    [IO.Directory]::CreateDirectory($source) | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'release-files.json'), '{}')
    $script:distros = @('Ubuntu', 'Ubuntu-Other')
    $script:calls = [Collections.Generic.List[object]]::new()
    $script:pythonPresent = $true
    $script:wsl2 = $true
    $script:userId = '1000'
    function Get-BootstrapSystemLanguage { return 'zh-CN' }
    function Get-BootstrapDistros { return $script:distros }
    function Find-BootstrapPython {
        if ($script:pythonPresent) { return @{ File = 'python-fixture'; Prefix = @() } }
        return $null
    }
    function Test-BootstrapWsl2 { param($SelectedDistro); return $script:wsl2 }
    function wsl.exe {
        $script:calls.Add(@($args))
        if ($args[2] -eq '--exec' -and $args[3] -eq 'id') { $global:LASTEXITCODE = 0; return $script:userId }
        if ($args[2] -eq '--exec' -and $args[3] -eq 'wslpath') {
            $global:LASTEXITCODE = 0
            return '/mounted/' + $args[5].Substring(3)
        }
        throw 'Unexpected WSL invocation.'
    }
    function Invoke-BootstrapWsl {
        param($SelectedDistro, $BootstrapPath, $Arguments)
        $script:calls.Add(@('runtime', $SelectedDistro, $BootstrapPath, @($Arguments)))
        return 0
    }
    function Invoke-BootstrapWslInstall {
        param($SelectedDistro)
        $script:calls.Add(@('install-wsl', $SelectedDistro))
        return 0
    }
    function Read-Host { return 'n' }
    $options = @{ Source = $source; Target = $target; Engine = 'codex'; Distro = 'Ubuntu-Other'; Plan = $true; NoDashboard = $true }
    $result = Invoke-BootstrapMain $options.Clone()
    Assert-Setup ($result -eq 0) 'Plan should succeed with selected distro.'
    $statePath = Join-Path $env:LOCALAPPDATA 'AutoCompany/setup-state.json'
    Assert-Setup (-not (Test-Path -LiteralPath $statePath)) 'Plan must not write checkpoint.'
    $runtime = @($script:calls | Where-Object { $_[0] -eq 'runtime' })
    Assert-Setup ($runtime.Count -eq 1 -and $runtime[0][1] -eq 'Ubuntu-Other') 'Plan must use selected distro.'
    Assert-Setup ($runtime[0][3] -contains '--plan') 'Runtime planning must be read-only.'
    Assert-Setup ($runtime[0][3] -contains '--skip-media') 'Windows default must not inherit an old WSL media choice.'
    Assert-Setup ($runtime[0][3] -contains ('/mounted/' + $target.Replace('\', '/').Substring(3))) 'Paths must preserve special characters.'

    $options.Plan = $false
    $result = Invoke-BootstrapMain $options.Clone()
    Assert-Setup ($result -eq 0 -and -not (Test-Path -LiteralPath $statePath)) 'Cancel must not write checkpoint.'

    $options.Yes = $true
    $options.Language = 'en'
    $result = Invoke-BootstrapMain $options.Clone()
    Assert-Setup ($result -eq 0) 'Mocked full bootstrap should finish.'
    $state = Get-BootstrapState $statePath
    Assert-Setup ($state.language -eq 'en' -and $state.distro -eq 'Ubuntu-Other' -and $state.target -eq $target -and $state.stage -eq 'complete') 'Checkpoint must persist identity, UI language, and literal path.'
    $runtime = @($script:calls | Where-Object { $_[0] -eq 'runtime' })
    Assert-Setup ($runtime[-1][3] -contains '--yes' -and $runtime[-1][3] -notcontains '--login') 'Approval must not silently log in.'
    $mediaOptions = $options.Clone()
    $mediaOptions.Media = $true
    $mediaOptions.Plan = $true
    $result = Invoke-BootstrapMain $mediaOptions
    $runtime = @($script:calls | Where-Object { $_[0] -eq 'runtime' })
    Assert-Setup ($result -eq 0 -and $runtime[-1][3] -contains '--media' -and $runtime[-1][3] -notcontains '--skip-media') 'Media enable must be explicit across the WSL boundary.'
    $skipOptions = $options.Clone()
    $skipOptions.SkipMedia = $true
    $skipOptions.Plan = $true
    $result = Invoke-BootstrapMain $skipOptions
    $runtime = @($script:calls | Where-Object { $_[0] -eq 'runtime' })
    Assert-Setup ($result -eq 0 -and $runtime[-1][3] -contains '--skip-media' -and $runtime[-1][3] -notcontains '--media') 'Explicit SkipMedia must override saved WSL state.'
    $resume = @{ Source = $source; Plan = $true; NoDashboard = $true }
    $result = Invoke-BootstrapMain $resume
    Assert-Setup ($result -eq 0 -and $script:BootstrapLanguage -eq 'en') 'Resume must use saved language despite different current OS UI.'

    $script:userId = '0'
    $result = Invoke-BootstrapMain $options.Clone()
    Assert-Setup ($result -eq 20 -and (Get-BootstrapState $statePath).stage -eq 'linux-user') 'Root-only distribution must require user setup, never run runtime.'
    $script:userId = '1000'
    $script:wsl2 = $false
    $before = $script:calls.Count
    $result = Invoke-BootstrapMain $options.Clone()
    Assert-Setup ($result -ne 0 -and $script:calls.Count -eq $before) 'WSL1 must not be silently converted.'
    $script:wsl2 = $true
    $script:distros = @()
    if ([Environment]::OSVersion.Version.Build -ge 22000) {
        $result = Invoke-BootstrapMain $options.Clone()
        Assert-Setup ($result -eq 3010 -and (Get-BootstrapState $statePath).stage -eq 'reboot-or-user') 'WSL installation must stop at resumable reboot, never report completion.'
    }
    $invalid = $options.Clone()
    $invalid.Target = "C:\bad`npath"
    $result = Invoke-BootstrapMain $invalid
    Assert-Setup ($result -ne 0) 'Newlines in paths must be rejected.'

    # Exercise argv forwarding itself with a native-boundary fixture.
    $sourceText = [IO.File]::ReadAllText((Join-Path $root 'scripts/install/bootstrap.ps1'))
    $ast = [Management.Automation.Language.Parser]::ParseInput($sourceText, [ref]$null, [ref]$null)
    $forward = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-BootstrapWsl' }, $true)
    Invoke-Expression $forward.Extent.Text
    function wsl.exe { $script:forwardArgs = @($args); $global:LASTEXITCODE = 0 }
    $null = Invoke-BootstrapWsl 'Ubuntu-Other' "/tmp/quote' dollar`$ space/bootstrap.sh" @('--target', "/tmp/a'b`$ c", '--yes')
    Assert-Setup ($script:forwardArgs[1] -eq 'Ubuntu-Other' -and $script:forwardArgs[5] -eq "/tmp/quote' dollar`$ space/bootstrap.sh" -and $script:forwardArgs[7] -eq "/tmp/a'b`$ c") 'WSL invocation must pass literal argv without command concatenation.'
    Write-Host "Installer PowerShell checks passed: $script:checks"
    $global:LASTEXITCODE = 0
} finally {
    $env:LOCALAPPDATA = $oldLocal
    $env:USERPROFILE = $oldProfile
    ${function:Get-BootstrapSystemLanguage} = $originalSystemLanguage
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -like 'auto-setup-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
