<#
.SYNOPSIS
    One command that runs every offline validator for the Stellar Blaze infra and prints a PASS / FAIL / SKIP summary.

.DESCRIPTION
    Nothing here needs Azure or an account. Steps (in this order):

      bicep             bicep lint + build of every .bicep, build-params of the two .bicepparam
      psrule            PSRule for Azure over main.bicepparam and bootstrap.bicepparam (Bicep expanded offline)
      checkov           Checkov (pinned Docker image, --network none) over the compiled templates
      actionlint        actionlint (+ shellcheck for the run: blocks) over .github/workflows
      act               act dry run of the infra job of ci.yml (SKIP until that job exists)
      hadolint          hadolint over backend/Dockerfile and frontend/Dockerfile
      trivy-image       trivy HIGH/CRITICAL scan of the locally built images stellar-blaze-api:i1 and stellar-blaze-web:i1
                        (report only: WARN with the counts, exit code unaffected; -StrictImages makes any HIGH or CRITICAL a FAIL)
      shellcheck        shellcheck over every .sh under infra/ and the extensionless test stubs
      psscriptanalyzer  PSScriptAnalyzer (Warning and Error) over every PowerShell file under infra/
      script-tests      bash infra/scripts/tests/run.sh and every Pester file under infra/scripts/tests/ps
      rehearsal         bash infra/local/rehearse.sh (slow; only with -Rehearsal)

    Every tool is pinned in infra/validate/tools.lock.json (version, official URL, sha256 / SHA512 / image digest, all looked
    up from the project's own release page or registry). On first use a tool is downloaded into -ToolsDir (outside the
    repository), checked against the lock and installed; a mismatch FAILS the step and nothing is installed. A step is SKIPPED
    only when its tool cannot be installed or run here (no Docker, no network, input not there yet), with the reason.

    A finding fails its step unless infra/validate/accepted-risks.json lists it: one entry per tool, rule id AND resource, with
    a written reason and a date. A wildcard is rejected, and there is no switch that suppresses findings in general.

    Full tool output goes to -OutputDir (printed at the start), never into the repository. Exit code 1 when any step FAILS.
    Runs on Windows PowerShell 5.1 and PowerShell 7.

.PARAMETER Only
    Run only these steps (comma separated).

.PARAMETER Skip
    Do not run these steps (comma separated).

.PARAMETER InstallOnly
    Install and verify the tools the selected steps need, then stop.

.PARAMETER ToolsDir
    Where the pinned tools are installed. Default: %LOCALAPPDATA%\stellar-blaze-i1\tools. Must be outside the repository.

.PARAMETER OutputDir
    Where the full output of every tool goes. Default: a new folder under the temp directory. Must be outside the repository.

.PARAMETER Rehearsal
    Also run the slow local rehearsal (infra/local/rehearse.sh).

.PARAMETER StrictImages
    Make any HIGH or CRITICAL vulnerability in the scanned images a FAIL (default: report only, WARN, exit code unaffected).

.PARAMETER Image
    The images the trivy-image step scans. Default: stellar-blaze-api:i1 and stellar-blaze-web:i1.

.EXAMPLE
    .\infra\scripts\validate-local.ps1
.EXAMPLE
    .\infra\scripts\validate-local.ps1 -Only bicep,psrule
#>
[CmdletBinding()]
param(
    [string[]]$Only = @(),
    [string[]]$Skip = @(),
    [switch]$InstallOnly,
    [string]$ToolsDir = '',
    [string]$OutputDir = '',
    [switch]$Rehearsal,
    [switch]$StrictImages,
    [string[]]$Image = @('stellar-blaze-api:i1', 'stellar-blaze-web:i1')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

. (Join-Path -Path $PSScriptRoot -ChildPath 'validate-local.lib.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..\..')).Path
$validateDir = Join-Path -Path $repoRoot -ChildPath 'infra\validate'

function Test-InsideRepo {
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/') + '\'
    return $full.StartsWith(($repoRoot.TrimEnd('\', '/') + '\'), [System.StringComparison]::OrdinalIgnoreCase)
}

if (-not $ToolsDir) { $ToolsDir = Join-Path -Path (Join-Path -Path $env:LOCALAPPDATA -ChildPath 'stellar-blaze-i1') -ChildPath 'tools' }
if (-not $OutputDir) { $OutputDir = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('stellar-blaze-validate-' + [datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')) }
$ToolsDir = [System.IO.Path]::GetFullPath($ToolsDir)
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
foreach ($pair in @(@('ToolsDir', $ToolsDir), @('OutputDir', $OutputDir))) {
    if (Test-InsideRepo -Path $pair[1]) {
        Write-Say -Text ('FAIL config            -{0} is inside the repository ({1}); tools and output must stay outside it.' -f $pair[0], $pair[1])
        exit 1
    }
}

Write-Say -Text ('validate-local: repo {0}' -f $repoRoot)
Write-Say -Text ('validate-local: tools {0}' -f $ToolsDir)
Write-Say -Text ('validate-local: output {0}' -f $OutputDir)

# ---- configuration: the lock and the accepted risks must be valid before anything runs ----------------------------
$configurationResults = New-Object System.Collections.Generic.List[object]
$lock = $null
$risks = @()
try { $lock = Read-ToolLock -Path (Join-Path -Path $validateDir -ChildPath 'tools.lock.json') }
catch { $configurationResults.Add((New-StepResult -Step 'config' -Status FAIL -Detail (($_.Exception.Message -replace '\s+', ' ').Trim()))) }
try { $risks = @(Read-AcceptedRiskFile -Path (Join-Path -Path $validateDir -ChildPath 'accepted-risks.json')) }
catch { $configurationResults.Add((New-StepResult -Step 'config' -Status FAIL -Detail (($_.Exception.Message -replace '\s+', ' ').Trim()))) }
if ($configurationResults.Count -gt 0) {
    foreach ($item in $configurationResults) { Write-Say -Text (Format-ResultLine -Result $item) }
    exit 1
}

$steps = @(Resolve-StepSelection -Only $Only -Skip $Skip)
foreach ($directory in @($ToolsDir, $OutputDir)) {
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
}
$context = New-ValidationContext -RepoRoot $repoRoot -ToolsDir $ToolsDir -OutputDir $OutputDir -Lock $lock -Risk $risks -TrivyImage $Image -Rehearsal ([bool]$Rehearsal) -StrictImages ([bool]$StrictImages)

$results = New-Object System.Collections.Generic.List[object]
if ($InstallOnly) {
    Write-Say -Text 'validate-local: installing and verifying tools only'
    foreach ($item in @(Install-StepTool -Context $context -Step $steps)) {
        $results.Add($item)
        Write-StepResult -Result $item -OutputDir $OutputDir
    }
}
else {
    foreach ($step in $steps) {
        $item = Invoke-ValidationStep -Context $context -Step $step
        $results.Add($item)
        Write-StepResult -Result $item -OutputDir $OutputDir
    }
}

# ---- summary ----------------------------------------------------------------------------------------------------------
Write-Say -Text ''
Write-Say -Text '==== validate-local summary ===='
foreach ($item in $results) {
    $line = Format-ResultLine -Result $item
    if ($line.Length -gt 200) { $line = $line.Substring(0, 197) + '...' }   # the full detail was printed above and is in the output folder
    Write-Say -Text ($line + ('  ({0}s)' -f $item.Seconds))
}
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$skipped = @($results | Where-Object { $_.Status -eq 'SKIP' }).Count
$passed = @($results | Where-Object { $_.Status -eq 'PASS' }).Count
$warned = @($results | Where-Object { $_.Status -eq 'WARN' }).Count
Write-Say -Text ('{0} passed, {1} failed, {2} skipped, {3} warned (a WARN does not fail the run). Full output: {4}' -f $passed, $failed, $skipped, $warned, $OutputDir)
exit (Get-ValidationExitCode -Result $results.ToArray())
