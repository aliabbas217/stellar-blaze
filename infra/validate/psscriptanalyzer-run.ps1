<#
.SYNOPSIS
    Child process of validate-local.ps1 (step psscriptanalyzer): runs PSScriptAnalyzer (Warning and Error) over every
    PowerShell file under a root and writes the findings as JSON. Not meant to be run by hand.

.PARAMETER Root
    The folder to analyse recursively (infra/).

.PARAMETER OutputPath
    Where the JSON array is written: [ { RuleName, Severity, ScriptPath, Line, Message } ].
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Import-Module -Name PSScriptAnalyzer

$files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Include '*.ps1', '*.psm1', '*.psd1' | Sort-Object -Property FullName)
$rows = New-Object System.Collections.Generic.List[object]
foreach ($file in $files) {
    foreach ($finding in @(Invoke-ScriptAnalyzer -Path $file.FullName -Severity Warning, Error)) {
        $rows.Add([pscustomobject]@{
                RuleName   = [string]$finding.RuleName
                Severity   = [string]$finding.Severity
                ScriptPath = [string]$finding.ScriptPath
                Line       = [int]$finding.Line
                Message    = [string]$finding.Message
            })
    }
}
[System.IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject @($rows.ToArray()) -Depth 4))
exit 0
