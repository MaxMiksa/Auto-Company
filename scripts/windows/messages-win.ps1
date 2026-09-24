# Keep this script ASCII so Windows PowerShell 5.1 reads it without a BOM.
# User-visible text lives in the UTF-8 catalog; native tool output is untouched.

function Resolve-AutoCompanyDistro {
    param([string]$RepoRoot = (Join-Path $PSScriptRoot '../..'), [string]$Fallback = 'Ubuntu')
    $path = Join-Path $RepoRoot '.auto-company/install.json'
    if (-not (Test-Path -LiteralPath $path)) { return $Fallback }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw (Get-AutoCompanyMessage -Key 'Managed installation metadata is invalid.')
    }
    try {
        $metadata = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $saved = $metadata.distro
        if ($metadata.schema -ne 1 -or ($saved -and $saved -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$')) {
            throw 'Invalid installation metadata.'
        }
        if ($saved) { return [string]$saved }
    } catch {
        throw (Get-AutoCompanyMessage -Key 'Managed installation metadata is invalid.')
    }
    return $Fallback
}

function Assert-AutoCompanyMaintenance {
    param([string]$RepoRoot = (Join-Path $PSScriptRoot '../..'))
    if (Test-Path -LiteralPath (Join-Path $RepoRoot '.auto-company/maintenance.json')) {
        throw (Get-AutoCompanyMessage -Key 'Installation maintenance is unfinished. Recover or finish the update first.')
    }
}

function Get-AutoCompanySystemLanguage {
    try {
        # CurrentUICulture can inherit a hosting shell's language instead of the
        # Windows user's display language. Query the same OS API as the runtime.
        if (-not ('AutoCompany.Localization.NativeMethods' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace AutoCompany.Localization {
    public static class NativeMethods {
        [DllImport("kernel32.dll")]
        public static extern ushort GetUserDefaultUILanguage();
    }
}
'@
        }
        $languageId = [AutoCompany.Localization.NativeMethods]::GetUserDefaultUILanguage()
        $cultureName = [System.Globalization.CultureInfo]::GetCultureInfo([int]$languageId).Name
        if ($cultureName -imatch '^zh(?:-|$)') { return 'zh-CN' }
    } catch {
        # Use a readable fallback if the Windows UI language is unavailable.
    }
    return 'en'
}

function Initialize-AutoCompanyMessages {
    param(
        [string]$RepoRoot = (Join-Path $PSScriptRoot '../..'),
        [string]$Language,
        [string]$CatalogPath
    )

    $script:AutoCompanyMessageLanguage = 'en'
    $script:AutoCompanyMessageCatalog = $null
    try {
        # Read the same shared state as the runtime. Legacy guardian arguments
        # are display fallbacks only; they cannot override a product or setting.
        $fallbackLanguage = $null
        if ($PSBoundParameters.ContainsKey('Language')) {
            if ($Language -ieq 'en') { $fallbackLanguage = 'en' }
            elseif ($Language -ieq 'zh-CN') { $fallbackLanguage = 'zh-CN' }
            else { throw 'Invalid language.' }
        }
        $settings = @{}
        $localPath = Join-Path $RepoRoot '.auto-company.local'
        if (Test-Path -LiteralPath $localPath) {
            $item = Get-Item -LiteralPath $localPath -Force -ErrorAction Stop
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw 'Local configuration must not be a symlink.'
            }
            $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
            $localText = $utf8.GetString([System.IO.File]::ReadAllBytes($localPath))
            foreach ($line in ($localText -split '\r\n|\n|\r')) {
                if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
                if ($line -cnotmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
                    throw 'Invalid local configuration.'
                }
                if ($settings.ContainsKey($Matches[1])) { throw 'Duplicate local setting.' }
                $settings[$Matches[1]] = $Matches[2]
            }
        }
        if ($settings.ContainsKey('AUTO_COMPANY_LANGUAGE') -and
            $settings['AUTO_COMPANY_LANGUAGE'] -cnotin @('zh-CN', 'en')) {
            throw 'Invalid language.'
        }
        $productKeys = @($settings.Keys | Where-Object { $_.StartsWith('AUTO_COMPANY_PRODUCT_') })
        if ($productKeys.Count -gt 0) {
            if ($productKeys.Count -ne 3 -or -not $settings.ContainsKey('AUTO_COMPANY_LANGUAGE') -or
                $settings['AUTO_COMPANY_PRODUCT_ID'] -cnotmatch '^[0-9a-f]{32}$' -or
                $settings['AUTO_COMPANY_PRODUCT_STATUS'] -cne 'active' -or
                $settings['AUTO_COMPANY_PRODUCT_LANGUAGE'] -cnotin @('zh-CN', 'en')) {
                throw 'Invalid product language state.'
            }
            $selected = $settings['AUTO_COMPANY_PRODUCT_LANGUAGE']
        } elseif ($settings.ContainsKey('AUTO_COMPANY_LANGUAGE')) {
            $selected = $settings['AUTO_COMPANY_LANGUAGE']
        } elseif ($null -ne $fallbackLanguage) {
            $selected = $fallbackLanguage
        } else {
            $selected = [Environment]::GetEnvironmentVariable('AUTO_COMPANY_LANGUAGE')
            if ($null -eq $selected) {
                $selected = Get-AutoCompanySystemLanguage
            }
        }
        if ($selected -cnotin @('zh-CN', 'en')) { throw 'Invalid language.' }
        $script:AutoCompanyMessageLanguage = $selected
    } catch {
        # English is the original diagnostic text. Let the runtime report its
        # own invalid configuration rather than fail while rendering an error.
        $script:AutoCompanyMessageLanguage = 'en'
    }

    try {
        if (-not $CatalogPath) { $CatalogPath = Join-Path $RepoRoot 'i18n/windows-messages.json' }
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $catalogText = $utf8.GetString([System.IO.File]::ReadAllBytes($CatalogPath))
        $script:AutoCompanyMessageCatalog = ConvertFrom-Json -InputObject $catalogText -ErrorAction Stop
    } catch {
        # The English key is also the fallback when a catalog is unavailable.
        $script:AutoCompanyMessageCatalog = $null
    }
}

function Get-AutoCompanyMessage {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [object[]]$Values = @()
    )

    $template = $Key
    if ($null -ne $script:AutoCompanyMessageCatalog) {
        $entry = $script:AutoCompanyMessageCatalog.PSObject.Properties[$Key]
        if ($null -ne $entry -and $null -ne $entry.Value) {
            $translation = $entry.Value.PSObject.Properties[$script:AutoCompanyMessageLanguage]
            if ($null -ne $translation -and $translation.Value -is [string] -and
                -not [string]::IsNullOrWhiteSpace($translation.Value)) {
                # A stale/broken translation must not drop diagnostic values.
                $expected = @([regex]::Matches($Key, '\{[0-9]+\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
                $actual = @([regex]::Matches($translation.Value, '\{[0-9]+\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
                if (($expected -join '|') -ceq ($actual -join '|')) {
                    $template = $translation.Value
                }
            }
        }
    }
    # One pass and a match evaluator keep $, braces, paths and untrusted native
    # diagnostics literal; neither shell expansion nor format-string evaluation.
    $resolvedValues = $Values
    return [regex]::Replace($template, '\{([0-9]+)\}', [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $index = 0
        if ([int]::TryParse($match.Groups[1].Value, [ref]$index) -and $index -lt $resolvedValues.Count) {
            return [string]$resolvedValues[$index]
        }
        return $match.Value
    })
}

Initialize-AutoCompanyMessages
