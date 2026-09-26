param(
    [int]$Port = 8810,
    [string]$DataDirectory,
    [string[]]$Source = @(),
    [string]$WslDistribution,
    [string]$WslUser
)

$ErrorActionPreference = 'Stop'
$centerRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$centerServer = Join-Path $centerRoot 'dashboard/center_server.py'
$centerArguments = @($centerServer, '--port', [string]$Port)
if ($DataDirectory) { $centerArguments += @('--data-dir', $DataDirectory) }
foreach ($centerSource in $Source) { $centerArguments += @('--source', $centerSource) }
if ($WslDistribution) { $centerArguments += @('--wsl-distro', $WslDistribution) }
if ($WslUser) { $centerArguments += @('--wsl-user', $WslUser) }
& python @centerArguments
exit $LASTEXITCODE
