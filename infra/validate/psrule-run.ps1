<#
.SYNOPSIS
    Child process of validate-local.ps1 (step psrule): runs PSRule for Azure over the Bicep parameter files and writes the
    results as JSON. Not meant to be run by hand.

.DESCRIPTION
    The parent starts this script in a fresh PowerShell with PSModulePath pointing at the checksum-verified modules, the
    PSRULE_AZURE_BICEP_PATH variable pointing at the pinned Bicep CLI, and the dummy environment variables that the
    .bicepparam files read. PSRule expands each parameter file with the Bicep CLI (offline) and evaluates the
    PSRule.Rules.Azure rules over the resources that come out. Running it in its own process keeps PSRule's assemblies out
    of the parent session.

.PARAMETER InputPath
    One or more .bicepparam paths, separated by ';'.

.PARAMETER OptionPath
    The PSRule options file (infra/validate/ps-rule.yaml).

.PARAMETER OutputPath
    Where the JSON is written: { results: [...], errors: [...], warnings: [...] }.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OptionPath,
    [Parameter(Mandatory)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
# PSRule reads this preference variable, which Windows PowerShell 5.1 does not define until something sets it; without it
# every run records a harmless "Cannot find a variable with the name 'PSModuleAutoLoadingPreference'" error.
$PSModuleAutoLoadingPreference = 'All'
Import-Module -Name PSRule.Rules.Azure

$paths = @($InputPath -split ';' | Where-Object { $_.Length -gt 0 })
$errorList = New-Object System.Collections.Generic.List[string]
$warningList = New-Object System.Collections.Generic.List[string]

$records = @(Invoke-PSRule -Module PSRule.Rules.Azure -InputPath $paths -Format File -Option $OptionPath -Outcome All `
        -ErrorAction Continue -ErrorVariable collectedErrors -WarningVariable collectedWarnings 3>$null)

foreach ($item in @($collectedErrors)) { $errorList.Add([string]$item) }
foreach ($item in @($collectedWarnings)) {
    $text = [string]$item
    # PSRule warns once per parameter file that the file itself matched no rule; the resources it expands to are evaluated.
    if ($text -match 'has not been processed because no matching rules were found') { continue }
    $warningList.Add($text)
}

$results = foreach ($record in $records) {
    $sourceText = (@($record.Source | ForEach-Object {
                if ($null -ne $_.PSObject.Properties['File']) { [string]$_.File } else { [string]$_ }
            }) -join ';')
    [pscustomobject]@{
        ruleName   = [string]$record.RuleName
        outcome    = [string]$record.Outcome
        targetName = [string]$record.TargetName
        targetType = [string]$record.TargetType
        level      = [string]$record.Level
        ref        = [string]$record.Ref
        reason     = @($record.Reason | ForEach-Object { [string]$_ })
        source     = $sourceText
    }
}

$document = [pscustomobject]@{ results = @($results); errors = @($errorList); warnings = @($warningList) }
[System.IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject $document -Depth 6))
exit 0
