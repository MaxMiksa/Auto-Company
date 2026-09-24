$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/windows/messages-win.ps1')
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('auto-company-install-ps-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$count = 0
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture '.auto-company') -Force | Out-Null
    if ((Resolve-AutoCompanyDistro -RepoRoot $fixture) -cne 'Ubuntu') { throw 'Clone fallback changed.' }
    $count++
    $metadata = Join-Path $fixture '.auto-company/install.json'
    [System.IO.File]::WriteAllText($metadata, '{"schema":1,"distro":"Ubuntu-24.04"}', $utf8)
    if ((Resolve-AutoCompanyDistro -RepoRoot $fixture) -cne 'Ubuntu-24.04') { throw 'Saved distro was ignored.' }
    $count++
    [System.IO.File]::WriteAllText($metadata, '{"schema":1,"distro":"bad\"name"}', $utf8)
    $rejected = $false
    try { Resolve-AutoCompanyDistro -RepoRoot $fixture | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe distro was accepted.' }
    $count++
    $catalog = Join-Path $PSScriptRoot '../i18n/windows-messages.json'
    Initialize-AutoCompanyMessages -RepoRoot $fixture -Language 'zh-CN' -CatalogPath $catalog
    [System.IO.File]::WriteAllText((Join-Path $fixture '.auto-company/maintenance.json'), '{}', $utf8)
    $message = ''
    try { Assert-AutoCompanyMaintenance -RepoRoot $fixture } catch { $message = $_.Exception.Message }
    if (-not $message -or $message -eq 'Installation maintenance is unfinished. Recover or finish the update first.') {
        throw 'Chinese maintenance diagnostic was not used.'
    }
    $count++
    Initialize-AutoCompanyMessages -RepoRoot $fixture -Language 'en' -CatalogPath $catalog
    $message = ''
    try { Assert-AutoCompanyMaintenance -RepoRoot $fixture } catch { $message = $_.Exception.Message }
    if ($message -cne 'Installation maintenance is unfinished. Recover or finish the update first.') { throw 'English maintenance diagnostic changed.' }
    $count++
    Write-Host "Windows installer integration: $count checks passed."
    $global:LASTEXITCODE = 0
} finally {
    $resolved = [System.IO.Path]::GetFullPath($fixture)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolved) -notlike 'auto-company-install-ps-*') { throw 'Unsafe cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
