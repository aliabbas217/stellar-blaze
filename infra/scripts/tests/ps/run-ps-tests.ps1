<#
.SYNOPSIS
    Runs the Pester tests and PSScriptAnalyzer over infra/scripts and exits non-zero on any failure.

.DESCRIPTION
    No network and no Azure needed. Needs Pester 5 and PSScriptAnalyzer 1.2x; install them with
      Install-Module Pester -MinimumVersion 5.5 -Scope CurrentUser
      Install-Module PSScriptAnalyzer -Scope CurrentUser
    or point -ModulePath at a folder that holds them (the build machine keeps checksum-verified copies outside the repo).

    Runs on Windows PowerShell 5.1 and PowerShell 7.

.PARAMETER ModulePath
    Optional folder prepended to PSModulePath (a folder that contains Pester and PSScriptAnalyzer).

.PARAMETER SkipDocker
    Exclude the tests tagged Docker (they need the local image stellar-blaze-api:i1; they skip themselves when it is absent).

.PARAMETER PesterOnly
    Skip PSScriptAnalyzer.

.PARAMETER ExcludeScript
    File names (not paths) of other lanes' scripts under infra/scripts to leave out of the analyzer run, for example while
    their owner fixes a finding. Default: none, every .ps1 under infra/scripts is analysed.
#>
[CmdletBinding()]
param(
    [string]$ModulePath = '',
    [switch]$SkipDocker,
    [switch]$PesterOnly,
    [string[]]$ExcludeScript = @()
)

$ErrorActionPreference = 'Stop'

if ($ModulePath) { $env:PSModulePath = $ModulePath + [System.IO.Path]::PathSeparator + $env:PSModulePath }

$here = $PSScriptRoot
$scriptsDir = (Resolve-Path -LiteralPath (Join-Path -Path $here -ChildPath '..\..')).Path

$pester = Get-Module -ListAvailable -Name Pester | Where-Object { $_.Version -ge [version]'5.0.0' } | Sort-Object -Property Version -Descending | Select-Object -First 1
if ($null -eq $pester) { throw 'Pester 5 is not installed (Install-Module Pester -MinimumVersion 5.5 -Scope CurrentUser).' }
Import-Module -Name $pester.Path -Force

$failures = 0

# ---- Pester -------------------------------------------------------------------------------------------------------
$configuration = New-PesterConfiguration
$configuration.Run.Path = (Join-Path -Path $here -ChildPath 'DeployLocal.Tests.ps1')
$configuration.Run.PassThru = $true
$configuration.Output.Verbosity = 'Normal'
if ($SkipDocker) { $configuration.Filter.ExcludeTag = @('Docker') }
$result = Invoke-Pester -Configuration $configuration
if ($result.FailedCount -gt 0 -or $result.FailedBlocksCount -gt 0 -or $result.FailedContainersCount -gt 0) { $failures++ }
$pesterSummary = 'Pester: {0} passed, {1} failed, {2} skipped, {3} not run' -f $result.PassedCount, $result.FailedCount, $result.SkippedCount, $result.NotRunCount

# ---- PSScriptAnalyzer ---------------------------------------------------------------------------------------------
$analyzerSummary = 'PSScriptAnalyzer: skipped'
if (-not $PesterOnly) {
    $analyzer = Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object -Property Version -Descending | Select-Object -First 1
    if ($null -eq $analyzer) { throw 'PSScriptAnalyzer is not installed (Install-Module PSScriptAnalyzer -Scope CurrentUser).' }
    Import-Module -Name $analyzer.Path -Force
    $findings = @(Invoke-ScriptAnalyzer -Path $scriptsDir -Recurse -Severity Warning, Error)
    # Only the .ps1 files are ours to analyse (the bash scripts and stubs next to them are not PowerShell).
    $findings = @($findings | Where-Object { $_.ScriptPath -like '*.ps1' -and $ExcludeScript -notcontains $_.ScriptName })
    foreach ($finding in $findings) {
        Write-Information -MessageData ('{0}:{1}:{2} {3} {4}: {5}' -f $finding.ScriptName, $finding.Line, $finding.Column, $finding.Severity, $finding.RuleName, $finding.Message) -InformationAction Continue
    }
    if ($findings.Count -gt 0) { $failures++ }
    $analyzerSummary = 'PSScriptAnalyzer {0}: {1} finding(s) at Warning or Error severity' -f $analyzer.Version, $findings.Count
}

# ---- summary ------------------------------------------------------------------------------------------------------
Write-Information -MessageData '' -InformationAction Continue
Write-Information -MessageData $pesterSummary -InformationAction Continue
Write-Information -MessageData $analyzerSummary -InformationAction Continue
if ($failures -gt 0) {
    Write-Information -MessageData 'RESULT: FAILED' -InformationAction Continue
    exit 1
}
Write-Information -MessageData 'RESULT: OK' -InformationAction Continue
exit 0
