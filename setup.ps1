# Run from an extracted, verified Windows release archive.
[CmdletBinding()]
param(
    [string]$Target, [string]$Source, [string]$Language, [string]$Engine,
    [string]$Distro, [switch]$Media, [switch]$SkipMedia, [switch]$Login, [switch]$Yes,
    [switch]$Plan, [switch]$NoDashboard, [switch]$Help
)
& (Join-Path $PSScriptRoot 'scripts/install/bootstrap.ps1') @PSBoundParameters
exit $LASTEXITCODE
