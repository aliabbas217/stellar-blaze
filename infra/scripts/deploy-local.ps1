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
      .\infra\scripts\deploy-local.ps1 -Action Validate              # read-only dry run: validate + what-if, both phases
      .\infra\scripts\deploy-local.ps1 -Action Deploy -Placeholder      # optional rehearsal of the Azure plumbing
      .\infra\scripts\deploy-local.ps1 -Action Deploy
      .\infra\scripts\deploy-local.ps1 -Action ResetDemo                # before every judged session (a new demo epoch)

.PARAMETER Action
    Doctor | InitSecrets | ShowSecrets | Bootstrap | Validate | Deploy | ResetDemo | Smoke | Status | Teardown.
    ResetClock is the old name of ResetDemo and still works (it prints a note).

.PARAMETER Placeholder
    With Validate: use the placeholder image set. With Deploy: rehearse the Azure plumbing with the public MCR quickstart images: no build, no push, no migration, no alerts worker.

.PARAMETER SkipBuild
    Reuse the images already in the registry for this tag (needs a clean working tree).

.PARAMETER NoRevoke
    Only for a network where Windows cannot reach the certificate revocation server (curl.exe then fails every https request
    with CRYPT_E_NO_REVOCATION_CHECK): passes --ssl-revoke-best-effort to every HTTP check of Deploy, Smoke and ResetDemo. A
    certificate that IS revoked is still refused.

.PARAMETER BudgetMonth
    Bootstrap only: yyyy-MM of the FIRST Bootstrap, for when state.json is lost. Without it Bootstrap uses state.json, then the
    parameters of the earlier sb-bootstrap deployment, then this month.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Doctor', 'InitSecrets', 'ShowSecrets', 'Bootstrap', 'Validate', 'Deploy', 'ResetDemo', 'ResetClock', 'Smoke', 'Status', 'Teardown')]
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
    [switch]$NoRevoke,
    [ValidatePattern('^\d{4}-(0[1-9]|1[0-2])$')]
    [string]$BudgetMonth,
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
        NoRevoke          = [bool]$NoRevoke
        Force             = [bool]$Force
        Yes               = [bool]$Yes
        IUnderstand       = [bool]$IUnderstand
    }
    foreach ($name in 'Location', 'ResourceGroup', 'ContactEmail', 'VapidSubject', 'PostgresVersion', 'GitHubOwner', 'BudgetMonth') {
        if ($PSBoundParameters.ContainsKey($name)) { $options[$name] = [string]$PSBoundParameters[$name] }
    }
    $config = Resolve-DeployConfig -Config (New-DeployConfig @options)

    switch ($Action) {
        'Doctor' { if ((Invoke-Doctor -Config $config) -gt 0) { $exitCode = 1 } }
        'InitSecrets' { Initialize-DemoSecret -Config $config }
        'ShowSecrets' { Invoke-ShowSecret -Config $config }
        'Bootstrap' { Invoke-Bootstrap -Config $config }
        'Validate' { if ((Invoke-Validate -Config $config) -gt 0) { $exitCode = 1 } }
        'Deploy' { Invoke-Deploy -Config $config }
        'ResetDemo' { Invoke-ResetDemo -Config $config }
        'ResetClock' {
            Write-Say 'Note: ResetClock is now called ResetDemo. It no longer restarts anything: it starts a new demo epoch through the web.'
            Invoke-ResetDemo -Config $config
        }
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
