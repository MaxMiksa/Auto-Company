param(
    [string]$Distro = "Ubuntu",
    [string]$TaskName = "AutoCompany-WSL-Start"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "messages-win.ps1")
if (-not $PSBoundParameters.ContainsKey("Distro")) { $Distro = Resolve-AutoCompanyDistro }

Assert-AutoCompanyMaintenance
if (-not (Get-Command schtasks.exe -ErrorAction SilentlyContinue)) {
    throw (Get-AutoCompanyMessage -Key 'schtasks.exe not found.')
}

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$startScript = Join-Path $repoWin "scripts\\windows\\start-win.ps1"
if (-not (Test-Path $startScript)) {
    throw (Get-AutoCompanyMessage -Key 'scripts/windows/start-win.ps1 not found: {0}' -Values @($startScript))
}

$taskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$startScript"" -Distro ""$Distro"""
$createOutput = & schtasks.exe /Create /TN $TaskName /SC ONLOGON /TR $taskAction /RL LIMITED /F 2>&1
if ($createOutput) {
    foreach ($line in $createOutput) {
        Write-Host $line
    }
}

if ($LASTEXITCODE -ne 0) {
    if (($createOutput -join "`n") -match "Access is denied") {
        throw (Get-AutoCompanyMessage -Key 'Failed to create task due to permission error. Run PowerShell as Administrator and retry.')
    }
    throw (Get-AutoCompanyMessage -Key 'Failed to create/update scheduled task: {0}' -Values @($TaskName))
}

Write-Host (Get-AutoCompanyMessage -Key 'Autostart enabled: {0}' -Values @($TaskName))
Write-Host "Action: $taskAction"
