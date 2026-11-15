<#
.SYNOPSIS
    The whole first deploy of the Stellar Blaze demo to Azure from one Windows PowerShell window, with your own az session.

.DESCRIPTION
    Does what .github/workflows/deploy.yml does, without GitHub. Native PowerShell (5.1 and 7); the repo bash scripts are
    not used. All logic is in DeployLocal.lib.ps1; this file only takes the parameters and dispatches.
    State lives outside the repository in %LOCALAPPDATA%\stellar-blaze-i1\ (secrets.json, state.json).

    Run from the repository root, in this order (see infra/README.md for what each prints):

      .\infra\scripts\deploy-local.ps1 -Action Doctor
      .\infra\scripts\deploy-local.ps1 -Action InitSecrets -VapidSubject mailto:you@your-domain.com
      .\infra\scripts\deploy-local.ps1 -Action Bootstrap -ContactEmail you@your-domain.com
      .\infra\scripts\deploy-local.ps1 -Action Deploy -Placeholder      # optional rehearsal of the Azure plumbing
      .\infra\scripts\deploy-local.ps1 -Action Deploy
      .\infra\scripts\deploy-local.ps1 -Action ResetClock               # before every judged session

.PARAMETER Action
    Doctor | InitSecrets | ShowSecrets | Bootstrap | Deploy | ResetClock | Smoke | Status | Teardown.

.PARAMETER Placeholder
    Rehearse the Azure plumbing with the public MCR quickstart images: no build, no push, no migration, no alerts worker.

.PARAMETER SkipBuild
    Reuse the images already in the registry for this tag (needs a clean working tree).

.PARAMETER ReplayNow
    ISO 8601 with offset. Used by ResetClock when given: sets SB_REPLAY_NOW on api and alerts.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Doctor', 'InitSecrets', 'ShowSecrets', 'Bootstrap', 'Deploy', 'ResetClock', 'Smoke', 'Status', 'Teardown')]
    [string]$Action,

    [string]$Location = 'uaenorth',
    [string]$ResourceGroup,
    [string]$ContactEmail,
    [string]$VapidSubject,
    [ValidateSet('17', '18')]
    [string]$PostgresVersion,
    [string]$GitHubOwner,
    [switch]$Placeholder,
    [switch]$SkipBuild,
    [switch]$AllowDirty,
    [string]$ReplayNow = '2026-06-14T10:10:00+04:00',
    [switch]$Yes,
    [switch]$IUnderstand,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

. (Join-Path -Path $PSScriptRoot -ChildPath 'DeployLocal.lib.ps1')

$exitCode = 0
try {
    # Only values the operator typed override what Bootstrap saved in state.json (location, resource group).
    $options = @{
        Placeholder       = [bool]$Placeholder
        SkipBuild         = [bool]$SkipBuild
        AllowDirty        = [bool]$AllowDirty
        Force             = [bool]$Force
        Yes               = [bool]$Yes
        IUnderstand       = [bool]$IUnderstand
        ReplayNow         = $ReplayNow
        ReplayNowExplicit = $PSBoundParameters.ContainsKey('ReplayNow')
    }
    foreach ($name in 'Location', 'ResourceGroup', 'ContactEmail', 'VapidSubject', 'PostgresVersion', 'GitHubOwner') {
        if ($PSBoundParameters.ContainsKey($name)) { $options[$name] = [string]$PSBoundParameters[$name] }
    }
    $config = Resolve-DeployConfig -Config (New-DeployConfig @options)

    switch ($Action) {
        'Doctor' { if ((Invoke-Doctor -Config $config) -gt 0) { $exitCode = 1 } }
        'InitSecrets' { Initialize-DemoSecret -Config $config }
        'ShowSecrets' { Invoke-ShowSecret -Config $config }
        'Bootstrap' { Invoke-Bootstrap -Config $config }
        'Deploy' { Invoke-Deploy -Config $config }
        'ResetClock' { Invoke-ResetClock -Config $config }
        'Smoke' { Invoke-Smoke -Config $config }
        'Status' { Invoke-Status -Config $config }
        'Teardown' { Show-Teardown -Config $config }
    }
}
catch {
    Write-Say ''
    Write-Say "ERROR: $($_.Exception.Message)"
    $exitCode = 1
}
exit $exitCode
