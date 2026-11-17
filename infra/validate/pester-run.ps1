<#
.SYNOPSIS
    Child process of validate-local.ps1 (step script-tests): runs one Pester 5 test file with the checksum-verified Pester
    and exits non-zero on any failure. Not meant to be run by hand.

.PARAMETER TestPath
    The *.Tests.ps1 file.

.PARAMETER SummaryPath
    Where a one-line summary is written (for the parent's report).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TestPath,
    [Parameter(Mandatory)][string]$SummaryPath
)

$ErrorActionPreference = 'Stop'
$pester = Get-Module -ListAvailable -Name Pester | Where-Object { $_.Version -ge [version]'5.0.0' } | Sort-Object -Property Version -Descending | Select-Object -First 1
if ($null -eq $pester) { throw 'Pester 5 is not installed.' }
Import-Module -Name $pester.Path -Force

$configuration = New-PesterConfiguration
$configuration.Run.Path = $TestPath
$configuration.Run.PassThru = $true
$configuration.Output.Verbosity = 'Normal'
$result = Invoke-Pester -Configuration $configuration

$summary = 'Pester {0}: {1} passed, {2} failed, {3} skipped' -f $pester.Version, $result.PassedCount, $result.FailedCount, $result.SkippedCount
[System.IO.File]::WriteAllText($SummaryPath, $summary)
if ($result.FailedCount -gt 0 -or $result.FailedBlocksCount -gt 0 -or $result.FailedContainersCount -gt 0) { exit 1 }
exit 0
