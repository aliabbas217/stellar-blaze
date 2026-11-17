[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'These are operator-script steps behind explicit -Action switches and confirmation prompts, not cmdlets; -WhatIf would not be honoured by the az, docker and git calls they wrap.')]
param()

# DeployLocal.lib.ps1 - all logic of infra/scripts/deploy-local.ps1, as functions.
#
# Dot-sourced by the entry script and by the Pester tests. It does what .github/workflows/deploy.yml does, from one
# Windows PowerShell window, with the operator's own `az` session. It is native PowerShell on purpose: the repo bash
# scripts are not used here, because Git Bash rewrites `/subscriptions/...` arguments and `az.cmd` output carries `\r`.
#
# Runs on Windows PowerShell 5.1 and PowerShell 7: no `&&`, `||`, `??`, ternary, `?.`, `-AsHashtable`, `Get-Date -AsUTC`.
#
# Rules this file follows:
#   - every native call (az, docker, git, curl.exe, icacls) goes through Invoke-Native, which captures stdout, sends stderr
#     to a temp file (Windows PowerShell 5.1 turns redirected native stderr into a terminating error under
#     $ErrorActionPreference = 'Stop'), checks $LASTEXITCODE and never puts an argument into an error message;
#   - secrets are never printed and never passed as arguments: they reach `az` only as process environment variables that
#     are removed again in a `finally`;
#   - text output goes through Write-Say (the information stream), which also masks any registered secret value.

$script:LibDir = $PSScriptRoot
$script:SecretValues = @()

$script:ProviderNamespaces = @(
    'Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.Insights', 'Microsoft.DBforPostgreSQL',
    'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity', 'Microsoft.Consumption'
)
$script:PlaceholderImage = 'mcr.microsoft.com/k8se/quickstart:latest'
$script:JobsPlaceholderImage = 'mcr.microsoft.com/k8se/quickstart-jobs:latest'
$script:DefaultReplayNow = '2026-06-14T10:10:00+04:00'
$script:MigrateJobName = 'job-migrate'
$script:RequiredRootCommonNames = @('DigiCert Global Root G2', 'Microsoft RSA Root Certificate Authority 2017')
# ADR 0042 (infra/bicep/main.bicep: pgSslRootCert, databaseUrlSecret and the module names). A test reads main.bicep and fails
# when any of these drifts from it.
$script:ExpectedRootCert = '/etc/ssl/certs/ca-certificates.crt'
$script:DatabaseUrlSecretName = 'sb-database-url'
$script:TlsTargets = @(
    @{ Name = 'api'; Kind = 'app'; Module = 'app-api' },
    @{ Name = 'alerts'; Kind = 'app'; Module = 'app-alerts' },
    @{ Name = 'job-migrate'; Kind = 'job'; Module = 'job-migrate' }
)
# The api mode: cool = minReplicas 0 (the api scales to zero when idle: the cheap default), warm = minReplicas 1 (always
# one replica: judged sessions, recording). state.json key `apiMode`; the Bicep reads API_MIN_REPLICAS.
$script:ApiMinReplicas = @{ cool = 0; warm = 1 }
$script:DefaultApiMode = 'cool'
# THE one place that says what the demo costs a month (the controller fills in the exact range from the cost table in
# infra/README.md); every Deploy, Doctor, Bootstrap and Status text takes it from here.
$script:CostSummary = 'about USD 45-55 a month with a paid Postgres (about USD 26-35 on the free Postgres offer), see infra/README.md for the table'
$script:TeardownNote = 'Delete everything after GITEX (11 December): -Action Teardown prints the delete command (it never runs it).'
# What state.json records about a DEPLOYMENT (as opposed to the Bootstrap foundation): dropped when its group is gone.
$script:DeploymentStateKeys = @(
    'postgresVersionDeployed', 'lastTag', 'placeholder', 'webFqdn', 'apiFqdn', 'apiImage', 'webImage',
    'smokePassed', 'smokeAt', 'epochId', 'previousEpochId', 'resetAt', 'apiMode', 'apiModeAt'
)
# The synthetic demo site, and how long one epoch of the replay clock lasts (ADR 0034 amendment, ADR 0066).
$script:DemoSiteId = 'site-demo-mussafah'
$script:DemoDayWindow = 'about 7 h 20 min'

# Every variable infra/bicep/main.bicepparam reads (the contract with the Bicep). Cleared after each deployment.
$script:ParamEnvNames = @(
    'ACR_NAME', 'APPS_IDENTITY_ID', 'POSTGRES_VERSION', 'PG_ADMIN_PASSWORD', 'GIT_SHA', 'DEPLOY_APPS',
    'API_IMAGE', 'API_TARGET_PORT', 'API_LIVE_PATH', 'API_READY_PATH', 'API_IS_PLACEHOLDER', 'API_MIN_REPLICAS',
    'WEB_IMAGE', 'WEB_TARGET_PORT', 'WEB_HEALTH_PATH', 'WEB_IS_PLACEHOLDER', 'JOBS_IMAGE',
    'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT', 'VAPID_PRIVATE_KEY', 'SB_ACCESS_TOKENS', 'DEMO_EMPLOYER_TOKEN',
    'SB_RULESET_ID', 'SB_MODEL_ID', 'TRUSTED_PROXY_HOPS'
)
# Every variable infra/bicep/bootstrap.bicepparam reads.
$script:BootstrapEnvNames = @('LOCATION', 'BUDGET_CONTACT_EMAIL', 'GITHUB_OWNER', 'OPERATOR_PRINCIPAL_ID', 'BUDGET_MONTH')

# ---------------------------------------------------------------------------------------------------------------------
# Output and secret masking
# ---------------------------------------------------------------------------------------------------------------------

function Register-SecretValue {
    [CmdletBinding()]
    param([string[]]$Value)
    foreach ($item in $Value) {
        if (-not [string]::IsNullOrEmpty($item) -and $item.Length -ge 8) {
            $script:SecretValues = @($script:SecretValues) + $item
        }
    }
}

function Protect-Text {
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $masked = $Text
    foreach ($secret in @($script:SecretValues)) {
        $masked = $masked.Replace($secret, '***')
    }
    return $masked
}

function Write-Say {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][AllowEmptyString()][string]$Message = '',
        # Only ShowSecrets sets this: its whole purpose is to print the values.
        [switch]$NoMask
    )
    $text = $Message
    if (-not $NoMask) { $text = Protect-Text -Text $Message }
    Write-Information -MessageData $text -InformationAction Continue
}

function Write-Next {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Command, [string]$Why = '')
    Write-Say ''
    if ($Why) { Write-Say "Next: $Why" } else { Write-Say 'Next:' }
    Write-Say "  $Command"
}

function Get-EntryScriptCommand {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Arguments)
    return ".\infra\scripts\deploy-local.ps1 $Arguments"
}

function Write-CostReminder {
    <# The one cost text of Deploy, Doctor, Bootstrap and Status: the summary constant, what is always on, and when to delete. #>
    [CmdletBinding()]
    param()
    Write-Say "Cost reminder: cheap mode (the api scales to zero when idle; web and the alerts worker stay up, one replica each): $script:CostSummary. Postgres B1ms, web and alerts bill by the hour for as long as they exist; the api bills while it has a replica (all the time when warm)."
    Write-Say $script:TeardownNote
}

# ---------------------------------------------------------------------------------------------------------------------
# Native commands
# ---------------------------------------------------------------------------------------------------------------------

function Get-NativeLabel {
    [CmdletBinding()]
    param([string]$FilePath, [string[]]$Arguments = @())
    # Only the program name and leading sub-command words: letters and hyphens only and short, so a value that could be a
    # secret (hex, digits, mixed case, long) can never end up in an error message.
    $words = @([System.IO.Path]::GetFileNameWithoutExtension($FilePath))
    foreach ($argument in $Arguments) {
        if ($words.Count -ge 5) { break }
        if ($argument -cmatch '^[a-z]+(-[a-z]+)*$' -and $argument.Length -le 24) { $words += $argument } else { break }
    }
    return ($words -join ' ')
}

function Invoke-Native {
    <#
    .SYNOPSIS
        Runs a native command and returns its stdout as one trimmed string. Throws on a non-zero exit code.
    .DESCRIPTION
        stderr is kept apart from stdout and shown only on failure: the first 15 lines, with registered secrets masked, next
        to the command NAME and never its arguments. -Live streams the output to the console instead (docker build and
        push) and returns nothing.

        Native stderr is merged with 2>&1 and separated again by type, with $ErrorActionPreference set to Continue in this
        function. Windows PowerShell 5.1 turns redirected native stderr into a terminating error only under 'Stop'; and
        redirecting it to a file instead (2>file) was tried and writes every line as a formatted error record with the
        script path and a CategoryInfo block, which pollutes the 15 lines that are shown.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$Live,
        [string]$Label = ''
    )
    if (-not $Label) { $Label = Get-NativeLabel -FilePath $FilePath -Arguments $Arguments }
    $ErrorActionPreference = 'Continue'
    if ($Live) {
        & $FilePath @Arguments | Out-Host
        $liveCode = $LASTEXITCODE
        if ($liveCode -ne 0) { throw "$Label failed (exit code $liveCode); the output is above." }
        return
    }
    $everything = @(& $FilePath @Arguments 2>&1)
    $code = $LASTEXITCODE
    $outLines = New-Object System.Collections.Generic.List[string]
    $errorLines = New-Object System.Collections.Generic.List[string]
    foreach ($item in $everything) {
        if ($item -is [System.Management.Automation.ErrorRecord]) { $errorLines.Add($item.ToString()) }
        else { $outLines.Add("$item") }
    }
    if ($code -ne 0) {
        $detail = Protect-Text -Text ((@($errorLines | Select-Object -First 15) | ForEach-Object { $_.TrimEnd() }) -join [Environment]::NewLine)
        throw "$Label failed (exit code $code).$([Environment]::NewLine)$detail"
    }
    return (($outLines -join "`n") -replace "`r", '').Trim()
}

function Test-CommandAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Name)
    return ($null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue))
}

function Start-DeployDelay {
    [CmdletBinding()]
    param([Parameter(Mandatory)][int]$Seconds)
    Start-Sleep -Seconds $Seconds
}

function Confirm-Action {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Prompt, [bool]$Yes = $false)
    if ($Yes) { return $true }
    $answer = Read-Host -Prompt "$Prompt Type 'yes' to continue"
    return ($answer -eq 'yes')
}

# ---------------------------------------------------------------------------------------------------------------------
# JSON, dates, environment
# ---------------------------------------------------------------------------------------------------------------------

function Get-JsonValue {
    <# Walks 'a.b[0].c' through a ConvertFrom-Json object; $null when any step is missing (safe under strict mode). #>
    [CmdletBinding()]
    param($InputObject, [Parameter(Mandatory)][string]$Path)
    $current = $InputObject
    foreach ($segment in $Path.Split('.')) {
        if ($null -eq $current) { return $null }
        $name = $segment
        $index = -1
        if ($segment -match '^(?<n>[^\[]+)\[(?<i>\d+)\]$') {
            $name = $Matches['n']
            $index = [int]$Matches['i']
        }
        $property = $current.PSObject.Properties[$name]
        if ($null -eq $property) { return $null }
        $current = $property.Value
        if ($index -ge 0) {
            $items = @($current)
            if ($items.Count -le $index) { return $null }
            $current = $items[$index]
        }
    }
    return $current
}

function ConvertFrom-JsonArray {
    <# ConvertFrom-Json on Windows PowerShell 5.1 emits a JSON array as ONE object; this always returns the elements. #>
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $parsed = $Text | ConvertFrom-Json
    return @($parsed | ForEach-Object { $_ })
}

function ConvertTo-UtcDateTime {
    <# A ConvertFrom-Json date: a string on Windows PowerShell 5.1, a DateTime on PowerShell 7. $null when empty. #>
    [CmdletBinding()]
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
    $text = "$Value"
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal
    return [DateTimeOffset]::Parse($text, [System.Globalization.CultureInfo]::InvariantCulture, $styles).UtcDateTime
}

function Set-ProcessEnvironment {
    <# Sets process-only variables; an empty value REMOVES the variable (assigning '' to $env:X would do the same). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Value)
    foreach ($key in $Value.Keys) {
        $item = $Value[$key]
        if ($null -eq $item -or "$item" -eq '') {
            [System.Environment]::SetEnvironmentVariable([string]$key, $null, 'Process')
        }
        else {
            [System.Environment]::SetEnvironmentVariable([string]$key, "$item", 'Process')
        }
    }
}

function Clear-ProcessEnvironment {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string[]]$Name)
    foreach ($item in $Name) { [System.Environment]::SetEnvironmentVariable($item, $null, 'Process') }
}

# ---------------------------------------------------------------------------------------------------------------------
# State and secrets files (outside the repository)
# ---------------------------------------------------------------------------------------------------------------------

function Get-RepoRoot {
    [CmdletBinding()]
    param()
    # infra/scripts -> infra -> repository root
    return (Split-Path -Parent (Split-Path -Parent $script:LibDir))
}

function Get-StateDirectory {
    [CmdletBinding()]
    param()
    if ($env:SB_I1_STATE_DIR) { return $env:SB_I1_STATE_DIR }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set. This script is for Windows.' }
    return (Join-Path -Path $env:LOCALAPPDATA -ChildPath 'stellar-blaze-i1')
}

function Assert-OutsideRepository {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [string]$RepoRoot = '')
    if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
    $separator = [System.IO.Path]::DirectorySeparatorChar
    if ($full.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($root + $separator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to keep state or secrets inside the repository ($root). Unset SB_I1_STATE_DIR."
    }
}

function Get-SecretsFilePath { [CmdletBinding()] param() return (Join-Path -Path (Get-StateDirectory) -ChildPath 'secrets.json') }
function Get-StateFilePath { [CmdletBinding()] param() return (Join-Path -Path (Get-StateDirectory) -ChildPath 'state.json') }

function Write-Utf8NoBom {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $content = $Text
    if (-not $content.EndsWith("`n")) { $content += "`n" }
    [System.IO.File]::WriteAllText($Path, $content, $encoding)
}

function Read-StateFile {
    <# Returns the flat state as an ordered hashtable (empty when there is no file). #>
    [CmdletBinding()]
    param()
    $state = [ordered]@{}
    $path = Get-StateFilePath
    if (Test-Path -LiteralPath $path) {
        $raw = Get-Content -LiteralPath $path -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $parsed = $raw | ConvertFrom-Json
            foreach ($property in $parsed.PSObject.Properties) { $state[$property.Name] = $property.Value }
        }
    }
    return $state
}

function Save-StateFile {
    [CmdletBinding()]
    param([System.Collections.IDictionary]$Update = @{}, [string[]]$Remove = @())
    $path = Get-StateFilePath
    Assert-OutsideRepository -Path $path
    $state = Read-StateFile
    foreach ($key in $Remove) { if ($state.Contains($key)) { $state.Remove($key) } }
    foreach ($key in $Update.Keys) { $state[$key] = $Update[$key] }
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    Write-Utf8NoBom -Path $path -Text (ConvertTo-Json -InputObject $state -Depth 5)
}

function Get-StateValue {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$State, [Parameter(Mandatory)][string]$Key)
    if ($State.Contains($Key)) { return "$($State[$Key])" }
    return ''
}

function Read-SecretFile {
    [CmdletBinding()]
    param()
    $path = Get-SecretsFilePath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "No secrets file at $path. Run: $(Get-EntryScriptCommand -Arguments '-Action InitSecrets -VapidSubject mailto:<your real address>')"
    }
    $secrets = (Get-Content -LiteralPath $path -Raw) | ConvertFrom-Json
    foreach ($field in 'pgAdminPassword', 'demoEmployerToken', 'accessTokens', 'vapidPublicKey', 'vapidPrivateKey', 'vapidSubject') {
        if ($null -eq $secrets.PSObject.Properties[$field] -or [string]::IsNullOrWhiteSpace("$($secrets.$field)")) {
            throw "secrets.json lacks '$field'. Re-create it with -Action InitSecrets -Force (back up the old file first)."
        }
    }
    Register-SecretValue -Value @($secrets.pgAdminPassword, $secrets.demoEmployerToken, $secrets.vapidPrivateKey)
    return $secrets
}

function Set-OwnerOnlyAcl {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    $grant = '{0}:F' -f $env:USERNAME
    Invoke-Native -FilePath 'icacls' -Arguments @($Path, '/inheritance:r', '/grant:r', $grant) | Out-Null
}

function Write-ProtectedFile {
    <# Creates the (empty) file, restricts its ACL to the current user, and only then writes the content. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Text)
    Assert-OutsideRepository -Path $Path
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType File -Path $Path -Force | Out-Null }
    Set-OwnerOnlyAcl -Path $Path
    Write-Utf8NoBom -Path $Path -Text $Text
}

# ---------------------------------------------------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------------------------------------------------

function New-DeployConfig {
    [CmdletBinding()]
    param(
        [string]$Location = '',
        [string]$ResourceGroup = '',
        [string]$ContactEmail = '',
        [string]$VapidSubject = '',
        [string]$PostgresVersion = '',
        [string]$GitHubOwner = '',
        [string]$BudgetMonth = '',
        [switch]$Placeholder,
        [switch]$SkipBuild,
        [switch]$AllowDirty,
        [switch]$NoRevoke,
        [switch]$Force,
        [switch]$Yes,
        [switch]$IUnderstand,
        [switch]$Warm,
        [switch]$Cool,
        [string]$RepoRoot = ''
    )
    if ($Warm -and $Cool) {
        throw '-Warm and -Cool cannot be used together: -Warm deploys the api with one replica always running, -Cool lets it scale to zero. Pass one of them, or neither (a re-deploy then keeps the recorded mode).'
    }
    if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }
    if ($BudgetMonth -and $BudgetMonth -notmatch '^\d{4}-(0[1-9]|1[0-2])$') {
        throw "-BudgetMonth must be yyyy-MM, for example 2026-11 (the month of the first Bootstrap). Got '$BudgetMonth'."
    }
    return @{
        Location        = $Location
        ResourceGroup   = $ResourceGroup
        ContactEmail    = $ContactEmail
        VapidSubject    = $VapidSubject
        PostgresVersion = $PostgresVersion
        GitHubOwner     = $GitHubOwner
        BudgetMonth     = $BudgetMonth
        Placeholder     = [bool]$Placeholder
        SkipBuild       = [bool]$SkipBuild
        AllowDirty      = [bool]$AllowDirty
        NoRevoke        = [bool]$NoRevoke
        Force           = [bool]$Force
        Yes             = [bool]$Yes
        IUnderstand     = [bool]$IUnderstand
        Warm            = [bool]$Warm
        Cool            = [bool]$Cool
        RepoRoot        = $RepoRoot
    }
}

function Assert-ModeSwitchUse {
    <# -Warm and -Cool say in which mode Deploy (or the dry run Validate) puts the apps; no other action takes them. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Action, [Parameter(Mandatory)][hashtable]$Config)
    $given = ([bool]$Config['Warm'] -or [bool]$Config['Cool'])
    if ($given -and @('Deploy', 'Validate') -notcontains $Action) {
        throw "-Warm and -Cool only go with -Action Deploy or Validate (they say which mode the apps are deployed in). To change a running deployment use -Action Warm or -Action Cool."
    }
}

function Get-ApiModeFromState {
    <# The recorded api mode, cool when there is none or it is not warm or cool. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$State)
    $value = (Get-StateValue -State $State -Key 'apiMode').Trim().ToLowerInvariant()
    if ($script:ApiMinReplicas.ContainsKey($value)) { return $value }
    return $script:DefaultApiMode
}

function Resolve-ApiMode {
    <# -Warm / -Cool on the config win; otherwise the mode recorded in state.json, so a re-deploy never flips it; else cool. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][System.Collections.IDictionary]$State)
    $mode = ''
    $source = ''
    if ([bool]$Config['Warm']) { $mode = 'warm'; $source = '-Warm' }
    elseif ([bool]$Config['Cool']) { $mode = 'cool'; $source = '-Cool' }
    elseif (Get-StateValue -State $State -Key 'apiMode') { $mode = Get-ApiModeFromState -State $State; $source = 'recorded in state.json' }
    else { $mode = $script:DefaultApiMode; $source = 'the default' }
    return [pscustomobject]@{ Mode = $mode; MinReplicas = [int]$script:ApiMinReplicas[$mode]; Source = $source }
}

function Resolve-DeployConfig {
    <# Fills Location and ResourceGroup: explicit value, else bootstrap state, else the default naming. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $state = Read-StateFile
    if (-not $Config.Location) {
        $fromState = Get-StateValue -State $state -Key 'location'
        if ($fromState) { $Config.Location = $fromState } else { $Config.Location = 'uaenorth' }
    }
    if (-not $Config.ResourceGroup) {
        $fromState = Get-StateValue -State $state -Key 'resourceGroupName'
        if ($fromState) { $Config.ResourceGroup = $fromState } else { $Config.ResourceGroup = "rg-stellarblaze-demo-$($Config.Location)" }
    }
    return $Config
}

# ---------------------------------------------------------------------------------------------------------------------
# Doctor (the preflight Ali runs before anything is created)
# ---------------------------------------------------------------------------------------------------------------------

function ConvertTo-LocationKey {
    [CmdletBinding()]
    param([string]$Text)
    return (($Text -replace '[\s"]', '').ToLowerInvariant())
}

function Get-PostgresVersionFromSkuText {
    <# Text search of the raw list-skus JSON (its shape is unverified): '18' only when a "18" version string appears. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$SkuJson)
    if ($SkuJson -notmatch 'Standard_B1ms') { return '' }
    if ($SkuJson -match '"18"') { return '18' }
    return '17'
}

function New-CheckResult {
    [CmdletBinding()]
    param([ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$What)
    return [pscustomobject]@{ Status = $Status; What = $What }
}

function Invoke-Doctor {
    <#
    .SYNOPSIS
        Native preflight: prints PASS, WARN or FAIL per check and returns the number of FAILs.
    .DESCRIPTION
        This is the check Ali runs before the first bootstrap or deploy. It replaces infra/scripts/preflight.sh for the
        local path (same checks, native PowerShell) and adds the tools the local path needs (docker, bicep, extension).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $location = $Config.Location
    $results = New-Object System.Collections.Generic.List[object]
    $say = {
        param($r)
        $results.Add($r)
        Write-Say ('{0} {1}' -f $r.Status, $r.What)
    }

    Write-Say "Doctor: checking this machine and the Azure subscription for $location. Nothing is created."

    # az on PATH and its version
    $azPresent = Test-CommandAvailable -Name 'az'
    if (-not $azPresent) {
        & $say (New-CheckResult -Status FAIL -What 'az is not on PATH. Install: winget install --exact --id Microsoft.AzureCLI, then open a NEW terminal.')
    }
    else {
        try {
            $versionJson = Invoke-Native -FilePath 'az' -Arguments @('version', '-o', 'json')
            $cliVersion = [string](Get-JsonValue -InputObject ($versionJson | ConvertFrom-Json) -Path 'azure-cli')
            $parsedVersion = $null
            if ([version]::TryParse($cliVersion, [ref]$parsedVersion) -and $parsedVersion -lt [version]'2.92.0') {
                & $say (New-CheckResult -Status WARN -What "az $cliVersion is older than 2.92 (the plan's version). Update: winget upgrade --id Microsoft.AzureCLI")
            }
            else {
                & $say (New-CheckResult -Status PASS -What "az $cliVersion")
            }
        }
        catch {
            & $say (New-CheckResult -Status FAIL -What "az version failed: $(($_.Exception.Message -split "`n")[0])")
        }
        try {
            $bicep = Invoke-Native -FilePath 'az' -Arguments @('bicep', 'version')
            & $say (New-CheckResult -Status PASS -What "az bicep: $(($bicep -split "`n")[0])")
        }
        catch {
            & $say (New-CheckResult -Status FAIL -What 'az bicep is not installed. Run: az bicep install --version v0.49.2')
        }
        try {
            $extension = Invoke-Native -FilePath 'az' -Arguments @('extension', 'show', '--name', 'containerapp', '--query', 'version', '-o', 'tsv')
            & $say (New-CheckResult -Status PASS -What "az extension containerapp $extension")
        }
        catch {
            & $say (New-CheckResult -Status FAIL -What 'az extension containerapp is missing. Run: az extension add --name containerapp --upgrade')
        }
    }

    # docker daemon
    if (-not (Test-CommandAvailable -Name 'docker')) {
        & $say (New-CheckResult -Status FAIL -What 'docker is not on PATH. Install and start Docker Desktop.')
    }
    else {
        try {
            $dockerVersion = Invoke-Native -FilePath 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}')
            & $say (New-CheckResult -Status PASS -What "docker daemon reachable (server $dockerVersion)")
        }
        catch {
            & $say (New-CheckResult -Status FAIL -What 'docker daemon is not reachable. Start Docker Desktop and wait until it says running.')
        }
    }

    if ($azPresent) {
        # signed in, subscription
        $account = $null
        try {
            $account = (Invoke-Native -FilePath 'az' -Arguments @('account', 'show', '-o', 'json')) | ConvertFrom-Json
            & $say (New-CheckResult -Status PASS -What "signed in as $(Get-JsonValue -InputObject $account -Path 'user.name')")
            & $say (New-CheckResult -Status PASS -What "subscription $(Get-JsonValue -InputObject $account -Path 'name') ($(Get-JsonValue -InputObject $account -Path 'id'))")
        }
        catch {
            & $say (New-CheckResult -Status FAIL -What 'not signed in. Run: az login (then az account set --subscription <id> if you have several)')
        }

        if ($null -ne $account) {
            # resource providers
            foreach ($provider in $script:ProviderNamespaces) {
                try {
                    $stateText = Invoke-Native -FilePath 'az' -Arguments @('provider', 'show', '--namespace', $provider, '--query', 'registrationState', '-o', 'tsv')
                }
                catch { $stateText = '' }
                if ($stateText -eq 'Registered') {
                    & $say (New-CheckResult -Status PASS -What "provider $provider registered")
                }
                else {
                    $shown = $stateText
                    if (-not $shown) { $shown = 'unknown' }
                    & $say (New-CheckResult -Status FAIL -What "provider $provider is $shown. Run: az provider register --namespace $provider --wait")
                }
            }

            # Container Apps environments in the location
            try {
                $locationsJson = Invoke-Native -FilePath 'az' -Arguments @('provider', 'show', '--namespace', 'Microsoft.App', '--query', "resourceTypes[?resourceType=='managedEnvironments'].locations[]", '-o', 'json')
                $locations = @(ConvertFrom-JsonArray -Text $locationsJson | ForEach-Object { ConvertTo-LocationKey -Text "$_" })
                if ($locations -contains (ConvertTo-LocationKey -Text $location)) {
                    & $say (New-CheckResult -Status PASS -What "Microsoft.App managed environments available in $location")
                }
                else {
                    & $say (New-CheckResult -Status FAIL -What "Microsoft.App managed environments are not offered in $location. Try another region (fallback ladder step 1).")
                }
            }
            catch {
                & $say (New-CheckResult -Status FAIL -What "could not read Microsoft.App locations: $(($_.Exception.Message -split "`n")[0])")
            }

            # PostgreSQL B1ms and the major version
            try {
                $skuJson = Invoke-Native -FilePath 'az' -Arguments @('postgres', 'flexible-server', 'list-skus', '--location', $location, '-o', 'json')
                $pgVersion = Get-PostgresVersionFromSkuText -SkuJson $skuJson
                if (-not $pgVersion) {
                    & $say (New-CheckResult -Status FAIL -What "PostgreSQL Standard_B1ms is not offered in $location for this subscription. File a region-access request (portal, Help + support) or try another region.")
                }
                elseif ($pgVersion -eq '18') {
                    & $say (New-CheckResult -Status PASS -What "PostgreSQL Standard_B1ms offered in $location; a version 18 entry exists, so PostgreSQL 18 will be used (unverified text match)")
                    Save-StateFile -Update @{ postgresVersion = '18' }
                }
                else {
                    & $say (New-CheckResult -Status WARN -What "PostgreSQL Standard_B1ms offered in $location but no `"18`" version entry: PostgreSQL 17 will be used")
                    Save-StateFile -Update @{ postgresVersion = '17' }
                }
            }
            catch {
                & $say (New-CheckResult -Status FAIL -What "az postgres flexible-server list-skus failed: $(($_.Exception.Message -split "`n")[0])")
            }

            # Owner
            try {
                $subscriptionId = [string](Get-JsonValue -InputObject $account -Path 'id')
                $assignee = ''
                try { $assignee = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv')) } catch { $assignee = '' }
                if (-not $assignee) { $assignee = [string](Get-JsonValue -InputObject $account -Path 'user.name') }
                $owner = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('role', 'assignment', 'list', '--assignee', $assignee, '--scope', "/subscriptions/$subscriptionId", '--include-inherited', '--query', "[?roleDefinitionName=='Owner'].roleDefinitionName", '-o', 'tsv'))
                if ($owner) {
                    & $say (New-CheckResult -Status PASS -What 'signed-in user is Owner on the subscription')
                }
                else {
                    & $say (New-CheckResult -Status FAIL -What 'no Owner role assignment found for you. If you are Owner through a group, check portal > Subscriptions > your subscription > Access control (IAM); otherwise ask the Owner.')
                }
            }
            catch {
                & $say (New-CheckResult -Status FAIL -What "could not list role assignments: $(($_.Exception.Message -split "`n")[0])")
            }
        }
    }

    # git working tree
    try {
        $dirty = Invoke-Native -FilePath 'git' -Arguments @('-C', $Config.RepoRoot, 'status', '--porcelain') -Label 'git status'
        if ($dirty) {
            & $say (New-CheckResult -Status WARN -What 'git working tree has uncommitted changes. Deploy refuses a dirty tree unless you pass -AllowDirty.')
        }
        else {
            & $say (New-CheckResult -Status PASS -What 'git working tree is clean')
        }
    }
    catch {
        & $say (New-CheckResult -Status WARN -What 'could not read git status (is git on PATH?)')
    }

    $fails = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $warns = @($results | Where-Object { $_.Status -eq 'WARN' }).Count
    Write-Say ''
    Write-Say "Doctor: $($results.Count - $fails - $warns) PASS, $warns WARN, $fails FAIL."
    $recordedMode = Get-ApiModeFromState -State (Read-StateFile)
    Write-Say ("api mode : {0} (the next Deploy puts the api at minReplicas {1}; change a running deployment with -Action Warm or -Action Cool)" -f $recordedMode, $script:ApiMinReplicas[$recordedMode])
    Write-CostReminder
    if ($fails -eq 0) {
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action InitSecrets -VapidSubject mailto:<your real address>') -Why 'create the secrets (once)'
    }
    else {
        Write-Say 'Fix every FAIL above, then run Doctor again.'
    }
    return $fails
}

function Test-AccountMatchesState {
    <# The problems (empty when none) of the az session being on another subscription or tenant than the one state.json was made for. #>
    [CmdletBinding()]
    param($Account)
    $problems = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Account) { return @() }
    $state = Read-StateFile
    $savedSubscription = Get-StateValue -State $state -Key 'subscriptionId'
    $savedTenant = Get-StateValue -State $state -Key 'tenantId'
    $currentSubscription = [string](Get-JsonValue -InputObject $Account -Path 'id')
    $currentTenant = [string](Get-JsonValue -InputObject $Account -Path 'tenantId')
    $currentName = [string](Get-JsonValue -InputObject $Account -Path 'name')
    if ($savedSubscription -and $currentSubscription -and ($savedSubscription -ine $currentSubscription)) {
        $problems.Add("this az session is on subscription '$currentName' ($currentSubscription), but state.json belongs to subscription $savedSubscription (made by Bootstrap). Switch with: az account set --subscription $savedSubscription   (or run Bootstrap here to start over in this subscription)")
    }
    elseif ($savedTenant -and $currentTenant -and ($savedTenant -ine $currentTenant)) {
        $problems.Add("this az session is in tenant $currentTenant, but state.json belongs to tenant $savedTenant (made by Bootstrap). Sign in to that tenant: az login --tenant $savedTenant")
    }
    return $problems.ToArray()
}

function Invoke-DoctorLite {
    <#
    .SYNOPSIS
        The checks Deploy and Bootstrap cannot work without. Returns the account object; throws one message listing every problem.
    .DESCRIPTION
        Also refuses an az session that is on another subscription or tenant than the one state.json was made for (its
        resource group, registry and apps live in that one). Bootstrap passes -AllowSubscriptionChange: it is the action that
        replaces the state.
    #>
    [CmdletBinding()]
    param([bool]$NeedDocker = $true, [switch]$AllowSubscriptionChange)
    $problems = New-Object System.Collections.Generic.List[string]
    $account = $null
    if (-not (Test-CommandAvailable -Name 'az')) { $problems.Add('az is not on PATH (winget install --exact --id Microsoft.AzureCLI, then a NEW terminal)') }
    else {
        try { $account = (Invoke-Native -FilePath 'az' -Arguments @('account', 'show', '-o', 'json')) | ConvertFrom-Json }
        catch { $problems.Add('not signed in to az (run: az login)') }
        try { Invoke-Native -FilePath 'az' -Arguments @('extension', 'show', '--name', 'containerapp', '--query', 'version', '-o', 'tsv') | Out-Null }
        catch { $problems.Add('az extension containerapp is missing (run: az extension add --name containerapp --upgrade)') }
        if (-not $AllowSubscriptionChange) { foreach ($problem in @(Test-AccountMatchesState -Account $account)) { $problems.Add($problem) } }
    }
    if ($NeedDocker) {
        if (-not (Test-CommandAvailable -Name 'docker')) { $problems.Add('docker is not on PATH (start Docker Desktop)') }
        else {
            try { Invoke-Native -FilePath 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}') | Out-Null }
            catch { $problems.Add('the docker daemon is not reachable (start Docker Desktop)') }
        }
    }
    if ($problems.Count -gt 0) {
        throw ("Pre-checks failed:`n  - " + ($problems -join "`n  - ") + "`nRun: $(Get-EntryScriptCommand -Arguments '-Action Doctor') for the full list.")
    }
    return $account
}

# ---------------------------------------------------------------------------------------------------------------------
# InitSecrets and ShowSecrets
# ---------------------------------------------------------------------------------------------------------------------

function New-RandomHex {
    [CmdletBinding()]
    param([int]$ByteCount = 32)
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return ([System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}

function Get-Sha256Hex {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text)) } finally { $sha.Dispose() }
    return ([System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant())
}

function ConvertTo-Base64Url {
    [CmdletBinding()]
    param([Parameter(Mandatory)][byte[]]$Bytes)
    return ([System.Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
}

function New-VapidKeyPair {
    <#
    .SYNOPSIS
        A VAPID P-256 key pair in the format `web-push generate-vapid-keys` prints.
    .DESCRIPTION
        Private = base64url of the 32-byte D (left-padded to 32), public = base64url of 0x04 || X || Y, no padding.
        py_vapid's Vapid.from_string reads the private key exactly like this (backend/.../webpush.py hands the string to
        pywebpush); the Docker-tagged test proves it against the real image.
    #>
    [CmdletBinding()]
    param()
    $curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
    $key = [System.Security.Cryptography.ECDsa]::Create($curve)
    try { $parameters = $key.ExportParameters($true) } finally { $key.Dispose() }
    $d = New-Object byte[] 32
    [System.Array]::Copy($parameters.D, 0, $d, 32 - $parameters.D.Length, $parameters.D.Length)
    $x = $parameters.Q.X
    $y = $parameters.Q.Y
    $public = New-Object byte[] 65
    $public[0] = 0x04
    [System.Array]::Copy($x, 0, $public, 1, 32)
    [System.Array]::Copy($y, 0, $public, 33, 32)
    return [pscustomobject]@{
        Private = (ConvertTo-Base64Url -Bytes $d)
        Public  = (ConvertTo-Base64Url -Bytes $public)
    }
}

function Test-VapidSubject {
    [CmdletBinding()]
    param([string]$Subject)
    if ($Subject -notmatch '^mailto:[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$') { return $false }
    if ($Subject -match '@(.+\.)?(example\.(com|org|net)|invalid|test|localhost)$') { return $false }
    return $true
}

function Initialize-DemoSecret {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $path = Get-SecretsFilePath
    Assert-OutsideRepository -Path $path -RepoRoot $Config.RepoRoot
    if (-not (Test-VapidSubject -Subject $Config.VapidSubject)) {
        throw "-VapidSubject must be mailto:<a real address you read>, for example mailto:you@your-domain.com (push services see it). Got '$($Config.VapidSubject)'."
    }
    if ((Test-Path -LiteralPath $path) -and -not $Config.Force) {
        Write-Say "secrets.json already exists at $path and was NOT changed."
        Write-Say 'It holds the database password and the VAPID key of any deployment you already made; replacing it needs -Force (back the old file up first).'
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Bootstrap -ContactEmail <your email>') -Why 'create the Azure foundation (once)'
        return
    }
    $token = New-RandomHex -ByteCount 32
    $password = New-RandomHex -ByteCount 32
    $hash = Get-Sha256Hex -Text $token
    $entry = [ordered]@{ actor = 'demo-bff'; role = 'employer'; employer_id = 'emp-demo' }
    $map = [ordered]@{}
    $map[$hash] = $entry
    $accessTokens = ConvertTo-Json -InputObject $map -Compress -Depth 5
    $vapid = New-VapidKeyPair
    Register-SecretValue -Value @($token, $password, $vapid.Private)
    $document = [ordered]@{
        schema                  = 1
        pgAdminPassword         = $password
        demoEmployerToken       = $token
        demoEmployerTokenSha256 = $hash
        accessTokens            = $accessTokens
        vapidPublicKey          = $vapid.Public
        vapidPrivateKey         = $vapid.Private
        vapidSubject            = $Config.VapidSubject
    }
    Write-ProtectedFile -Path $path -Text (ConvertTo-Json -InputObject $document -Depth 5)
    Write-Say "Secrets written to: $path"
    Write-Say '(readable only by your Windows account; never inside the repository; never printed)'
    Write-Say "VAPID public key (not a secret): $($vapid.Public)"
    Write-Say 'Back this file up in your password manager now. Without it you cannot redeploy to the same database or rebuild the same keys.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Bootstrap -ContactEmail <your email>') -Why 'create the Azure foundation (once)'
}

function Invoke-ShowSecret {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    if (-not $Config.IUnderstand) {
        throw 'ShowSecrets prints secrets to this console. Re-run with -IUnderstand if you really need them (only for the Render fallback).'
    }
    $secrets = Read-SecretFile
    Write-Say 'WARNING: the values below stay in this terminal scrollback and in any transcript. Clear the screen after pasting them (Clear-Host) and close the window.'
    Write-Say ''
    Write-Say "DEMO_EMPLOYER_TOKEN=$($secrets.demoEmployerToken)" -NoMask
    Write-Say "SB_ACCESS_TOKENS=$($secrets.accessTokens)" -NoMask
    Write-Say "VAPID_PUBLIC_KEY=$($secrets.vapidPublicKey)" -NoMask
    Write-Say "SB_VAPID_PRIVATE_KEY=$($secrets.vapidPrivateKey)" -NoMask
    Write-Say "SB_VAPID_SUBJECT=$($secrets.vapidSubject)" -NoMask
    Write-Say ''
    Write-Say 'These are the five values the Render fallback needs (infra/render/README.md). The database password is not needed there.'
}

# ---------------------------------------------------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------------------------------------------------

function Resolve-BudgetMonth {
    <#
    .SYNOPSIS
        The BUDGET_MONTH of a Bootstrap run: -BudgetMonth, else state.json, else the earlier bootstrap deployment, else this month.
    .DESCRIPTION
        The budget starts in the month of the FIRST run and its start cannot move, so a later run must pass the same month.
        When state.json is lost, the parameters of the earlier `sb-bootstrap` deployment record still hold it.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][System.Collections.IDictionary]$State)
    if ($Config.BudgetMonth) { return [pscustomobject]@{ Month = $Config.BudgetMonth; Source = '-BudgetMonth' } }
    $fromState = Get-StateValue -State $State -Key 'budgetMonth'
    if ($fromState) { return [pscustomobject]@{ Month = $fromState; Source = 'state.json' } }
    try {
        $recorded = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('deployment', 'sub', 'show', '--name', 'sb-bootstrap', '--query', 'properties.parameters.budgetMonth.value', '-o', 'tsv', '--only-show-errors'))
        if ($recorded -match '^\d{4}-(0[1-9]|1[0-2])$') { return [pscustomobject]@{ Month = $recorded; Source = 'the earlier bootstrap deployment' } }
    }
    catch { Write-Verbose 'No earlier bootstrap deployment record; this is a first run.' }
    $current = (Get-Date).ToUniversalTime().ToString('yyyy-MM', [System.Globalization.CultureInfo]::InvariantCulture)
    return [pscustomobject]@{ Month = $current; Source = 'this month' }
}

function Invoke-Bootstrap {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    if ([string]::IsNullOrWhiteSpace($Config.ContactEmail)) {
        throw '-ContactEmail is required: the address that receives the monthly budget alerts.'
    }
    $account = Invoke-DoctorLite -NeedDocker $false -AllowSubscriptionChange
    $state = Read-StateFile
    $budget = Resolve-BudgetMonth -Config $Config -State $state
    $month = $budget.Month
    $paramFile = Join-Path -Path $Config.RepoRoot -ChildPath 'infra\bicep\bootstrap.bicepparam'
    if (-not (Test-Path -LiteralPath $paramFile)) { throw "Missing $paramFile. Run this from a checkout of the feat/i1-azure-infra branch." }

    # Facts about a deployment that this script saved are only true while that deployment exists, in that subscription.
    $newLife = $false
    $reason = ''
    $savedSubscription = Get-StateValue -State $state -Key 'subscriptionId'
    $currentSubscription = [string](Get-JsonValue -InputObject $account -Path 'id')
    if ($savedSubscription -and $currentSubscription -and ($savedSubscription -ine $currentSubscription)) {
        $newLife = $true
        $reason = "state.json was made for another subscription ($savedSubscription), so what it recorded about an earlier deployment is dropped"
    }
    else {
        $groupExists = 'true'
        try { $groupExists = (Invoke-Native -FilePath 'az' -Arguments @('group', 'exists', '--name', $Config.ResourceGroup)).Trim().ToLowerInvariant() }
        catch { $groupExists = 'true' }
        if ($groupExists -eq 'false') {
            $newLife = $true
            $reason = "the resource group $($Config.ResourceGroup) does not exist (deleted, or never created), so what state.json recorded about an earlier deployment is dropped"
        }
    }

    Write-Say "Bootstrap (one time, as Owner): subscription $(Get-JsonValue -InputObject $account -Path 'name'), region $($Config.Location)."
    Write-Say "It creates the resource group $($Config.ResourceGroup), a monthly budget alert that emails $($Config.ContactEmail) (the amount is set in infra/bicep/bootstrap.bicep), two identities, the registry (Basic) and the role assignments."
    Write-CostReminder
    Write-Say "Budget month: $month ($($budget.Source)). A re-run in a later month reuses it."
    if ($newLife) { Write-Say "Note: $reason." }
    if ($Config.GitHubOwner) { Write-Say "GitHub owner: $($Config.GitHubOwner) (a federated credential for repo:$($Config.GitHubOwner)/stellar-blaze:environment:demo is created)." }
    else { Write-Say 'No -GitHubOwner: no federated credential is created (add it later by re-running with -GitHubOwner).' }

    $operator = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'))
    if (-not $operator) { throw 'Could not read your object id (az ad signed-in-user show). Sign in again with: az login' }

    $values = @{
        LOCATION              = $Config.Location
        BUDGET_CONTACT_EMAIL  = $Config.ContactEmail
        GITHUB_OWNER          = $Config.GitHubOwner
        OPERATOR_PRINCIPAL_ID = $operator
        BUDGET_MONTH          = $month
    }
    Set-ProcessEnvironment -Value $values
    try {
        Write-Say ''
        Write-Say '[1/3] what-if (nothing is created yet; expect only + Create on a first run):'
        Invoke-Native -FilePath 'az' -Arguments @('deployment', 'sub', 'what-if', '--name', 'sb-bootstrap', '--location', $Config.Location, '--parameters', $paramFile) -Live
        if (-not (Confirm-Action -Prompt 'Create these resources now?' -Yes $Config.Yes)) { throw 'Cancelled by the operator. Nothing was created.' }
        Write-Say '[2/3] creating (2 to 4 minutes)...'
        Invoke-Native -FilePath 'az' -Arguments @('deployment', 'sub', 'create', '--name', 'sb-bootstrap', '--location', $Config.Location, '--parameters', $paramFile, '--only-show-errors', '-o', 'none') | Out-Null
    }
    finally {
        Clear-ProcessEnvironment -Name $script:BootstrapEnvNames
    }
    Write-Say '[3/3] reading the outputs...'
    $outputs = (Invoke-Native -FilePath 'az' -Arguments @('deployment', 'sub', 'show', '--name', 'sb-bootstrap', '--query', 'properties.outputs', '-o', 'json')) | ConvertFrom-Json
    $update = [ordered]@{
        acrName           = [string](Get-JsonValue -InputObject $outputs -Path 'acrName.value')
        acrLoginServer    = [string](Get-JsonValue -InputObject $outputs -Path 'acrLoginServer.value')
        appsIdentityId    = [string](Get-JsonValue -InputObject $outputs -Path 'appsIdentityId.value')
        resourceGroupName = [string](Get-JsonValue -InputObject $outputs -Path 'resourceGroupName.value')
        subscriptionId    = [string](Get-JsonValue -InputObject $outputs -Path 'subscriptionId.value')
        tenantId          = [string](Get-JsonValue -InputObject $outputs -Path 'tenantId.value')
        budgetMonth       = $month
        location          = $Config.Location
    }
    foreach ($required in 'acrName', 'acrLoginServer', 'appsIdentityId', 'resourceGroupName', 'subscriptionId', 'tenantId') {
        if (-not $update[$required]) { throw "The bootstrap deployment has no output '$required'. Inspect: az deployment sub show --name sb-bootstrap" }
    }
    $stale = @()
    if ($newLife) { $stale = $script:DeploymentStateKeys }
    Save-StateFile -Update $update -Remove $stale
    Write-Say "Registry: $($update.acrLoginServer)    Resource group: $($update.resourceGroupName)"
    Write-Say 'Saved to state.json (identifiers only, no secrets).'
    Write-Say ''
    Write-Say 'WAIT about 10 minutes before the first real deploy: the AcrPull role assignment of the apps identity takes minutes to propagate, and the first image pull fails with an unhelpful error until it does. Deploy retries the migration once to cover this.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Deploy') -Why 'in about 10 minutes (or first rehearse the Azure plumbing with -Placeholder)'
}

# ---------------------------------------------------------------------------------------------------------------------
# Deploy: tag, build, root-store check, push
# ---------------------------------------------------------------------------------------------------------------------

function Get-ImageTag {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $root = $Config.RepoRoot
    $sha = Invoke-Native -FilePath 'git' -Arguments @('-C', $root, 'rev-parse', '--short=12', 'HEAD') -Label 'git rev-parse'
    if (-not $sha) { throw 'git rev-parse returned nothing. Is this a git checkout?' }
    $porcelain = Invoke-Native -FilePath 'git' -Arguments @('-C', $root, 'status', '--porcelain') -Label 'git status'
    $dirty = -not [string]::IsNullOrWhiteSpace($porcelain)
    if (-not $dirty) { return [pscustomobject]@{ Sha = $sha; Tag = $sha; Dirty = $false } }
    if (-not $Config.AllowDirty) {
        throw "The working tree has uncommitted or untracked changes, so image tag $sha would not describe what is built. Commit them, or pass -AllowDirty (the tag then becomes $sha-dirty-<timestamp>)."
    }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss', [System.Globalization.CultureInfo]::InvariantCulture)
    return [pscustomobject]@{ Sha = $sha; Tag = "$sha-dirty-$stamp"; Dirty = $true }
}

function Get-ApiBuildArgument {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Image, [Parameter(Mandatory)][string]$Context)
    return @('build', '--platform', 'linux/amd64', '--tag', $Image, $Context)
}

function Get-WebBuildArgument {
    <# NEXT_PUBLIC_SB_DEMO is empty on purpose: empty is demo mode, the safe default. It is never 0 (frontend/README.md). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Image, [Parameter(Mandatory)][string]$Context, [Parameter(Mandatory)][string]$Tag)
    return @('build', '--platform', 'linux/amd64', '--build-arg', "APP_VERSION=$Tag", '--build-arg', 'NEXT_PUBLIC_SB_DEMO=', '--tag', $Image, $Context)
}

function Get-RootStoreScript {
    <# One line of Python (no double quotes: PowerShell 5.1 mangles them in native arguments). Port of check-db-tls.sh --image. #>
    [CmdletBinding()]
    param([string[]]$RequiredCommonName = $script:RequiredRootCommonNames)
    $names = ($RequiredCommonName | ForEach-Object { "'" + $_ + "'" }) -join ','
    return ("import os,ssl,sys;c=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT);c.load_verify_locations(cafile=os.environ['PGSSLROOTCERT']);" +
        "n={dict(y for x in k['subject'] for y in x).get('commonName') for k in c.get_ca_certs()};" +
        "m=sorted({$names}-n);sys.exit('root store lacks: '+', '.join(m) if m else 0)")
}

function Test-ApiImageRootStore {
    <# ADR 0042, Review Focus 6: the built api image must trust both roots Azure Database for PostgreSQL uses. Throws if not. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Image, [string[]]$RequiredCommonName = $script:RequiredRootCommonNames)
    $script = Get-RootStoreScript -RequiredCommonName $RequiredCommonName
    Invoke-Native -FilePath 'docker' -Arguments @('run', '--rm', '-e', 'PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt', '--entrypoint', 'python', $Image, '-c', $script) -Label 'docker run (root store check)' | Out-Null
}

function Format-Elapsed {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Diagnostics.Stopwatch]$Stopwatch)
    return ('{0:mm\:ss}' -f $Stopwatch.Elapsed)
}

function Invoke-ImageBuild {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Registry, [Parameter(Mandatory)][string]$Tag)
    $apiImage = "$Registry/sb-api:$Tag"
    $webImage = "$Registry/sb-web:$Tag"
    Write-Say 'Building two images with your local Docker. The api image is 1.8 GB on disk (427 MB compressed); the web build can take 10 minutes on a slow network. Output follows.'
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-Native -FilePath 'docker' -Arguments (Get-ApiBuildArgument -Image $apiImage -Context (Join-Path -Path $Config.RepoRoot -ChildPath 'backend')) -Live -Label 'docker build (api)'
    Write-Say "api image built in $(Format-Elapsed -Stopwatch $watch)"
    $watch.Restart()
    Invoke-Native -FilePath 'docker' -Arguments (Get-WebBuildArgument -Image $webImage -Context (Join-Path -Path $Config.RepoRoot -ChildPath 'frontend') -Tag $Tag) -Live -Label 'docker build (web)'
    Write-Say "web image built in $(Format-Elapsed -Stopwatch $watch)"
    return [pscustomobject]@{ Api = $apiImage; Web = $webImage }
}

function Push-DeployImage {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string[]]$Image)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($item in $Image) {
        Write-Say "Pushing $item (the api image is 427 MB compressed)..."
        Invoke-Native -FilePath 'docker' -Arguments @('push', $item) -Live -Label 'docker push'
        Write-Say "pushed after $(Format-Elapsed -Stopwatch $watch)"
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# Deploy: parameters, the two Bicep phases, the migration, the revision gate
# ---------------------------------------------------------------------------------------------------------------------

function Get-MainParamValue {
    <# The environment of infra/bicep/main.bicepparam (contract with chunk 2). Contains secrets: never print the result. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][System.Collections.IDictionary]$State,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$PostgresVersion,
        [Parameter(Mandatory)][bool]$DeployApps,
        [string]$ApiImage = '',
        [string]$WebImage = ''
    )
    $apiMode = Resolve-ApiMode -Config $Config -State $State
    $values = [ordered]@{
        ACR_NAME            = Get-StateValue -State $State -Key 'acrName'
        APPS_IDENTITY_ID    = Get-StateValue -State $State -Key 'appsIdentityId'
        POSTGRES_VERSION    = $PostgresVersion
        PG_ADMIN_PASSWORD   = $Secrets.pgAdminPassword
        GIT_SHA             = $Tag
        DEPLOY_APPS         = $DeployApps.ToString().ToLowerInvariant()
        JOBS_IMAGE          = $script:JobsPlaceholderImage
        # 0 (cool: the api scales to zero when idle) or 1 (warm: one replica always); from the recorded mode or -Warm / -Cool.
        API_MIN_REPLICAS    = "$($apiMode.MinReplicas)"
        VAPID_PUBLIC_KEY    = $Secrets.vapidPublicKey
        VAPID_SUBJECT       = $Secrets.vapidSubject
        VAPID_PRIVATE_KEY   = $Secrets.vapidPrivateKey
        SB_ACCESS_TOKENS    = $Secrets.accessTokens
        DEMO_EMPLOYER_TOKEN = $Secrets.demoEmployerToken
        # Empty means unset (the backend refuses both pins under SB_ENV=prod); Set-ProcessEnvironment removes empty values.
        SB_RULESET_ID       = ''
        SB_MODEL_ID         = ''
        TRUSTED_PROXY_HOPS  = '1'
    }
    if ($Config.Placeholder) {
        $values['API_IMAGE'] = $script:PlaceholderImage
        $values['WEB_IMAGE'] = $script:PlaceholderImage
        $values['API_TARGET_PORT'] = '80'
        $values['WEB_TARGET_PORT'] = '80'
        $values['API_LIVE_PATH'] = '/'
        $values['API_READY_PATH'] = '/'
        $values['WEB_HEALTH_PATH'] = '/'
        $values['API_IS_PLACEHOLDER'] = 'true'
        $values['WEB_IS_PLACEHOLDER'] = 'true'
    }
    else {
        $values['API_IMAGE'] = $ApiImage
        $values['WEB_IMAGE'] = $WebImage
        $values['API_TARGET_PORT'] = '8000'
        $values['WEB_TARGET_PORT'] = '3000'
        $values['API_LIVE_PATH'] = '/api/v1/health/live'
        $values['API_READY_PATH'] = '/api/v1/health/ready'
        $values['WEB_HEALTH_PATH'] = '/api/healthz'
        $values['API_IS_PLACEHOLDER'] = 'false'
        $values['WEB_IS_PLACEHOLDER'] = 'false'
    }
    return $values
}

function Invoke-MainDeployment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][System.Collections.IDictionary]$ParamValue
    )
    $paramFile = Join-Path -Path $Config.RepoRoot -ChildPath 'infra\bicep\main.bicepparam'
    if (-not (Test-Path -LiteralPath $paramFile)) { throw "Missing $paramFile. Run this from a checkout of the feat/i1-azure-infra branch." }
    Set-ProcessEnvironment -Value $ParamValue
    try {
        # -o none: the CLI would otherwise print the deployment, parameters included.
        Invoke-Native -FilePath 'az' -Arguments @('deployment', 'group', 'create', '--resource-group', $Config.ResourceGroup, '--name', $Name, '--parameters', $paramFile, '--only-show-errors', '-o', 'none') | Out-Null
    }
    finally {
        Clear-ProcessEnvironment -Name $script:ParamEnvNames
    }
}

function Wait-JobExecution {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroup,
        [Parameter(Mandatory)][string]$Execution,
        [int]$TimeoutSeconds = 600,
        [int]$IntervalSeconds = 10
    )
    $waited = 0
    $status = ''
    while ($true) {
        try {
            $status = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'execution', 'show', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '--job-execution-name', $Execution, '--query', 'properties.status', '-o', 'tsv', '--only-show-errors')
        }
        catch { $status = 'Unknown' }
        if ($status -eq 'Succeeded') { return 'Succeeded' }
        if ($status -eq 'Failed' -or $status -eq 'Stopped') { return 'Failed' }
        if ($waited -ge $TimeoutSeconds) { return 'Timeout' }
        Write-Say "  migration $Execution is $status ($waited s)"
        Start-DeployDelay -Seconds $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Start-MigrationExecution {
    <# Starts job-migrate and returns the execution name. The CLI prints something undocumented, so an empty answer, or the
       job name itself, falls back to the newest execution in the list. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ResourceGroup)
    $started = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'start', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '--query', 'name', '-o', 'tsv', '--only-show-errors'))
    if ($started -and $started -ne $script:MigrateJobName) { return $started }
    $listJson = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'execution', 'list', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '-o', 'json', '--only-show-errors')
    $items = @(ConvertFrom-JsonArray -Text $listJson)
    if ($items.Count -eq 0) { throw "az containerapp job start printed no execution name and the execution list of $script:MigrateJobName is empty." }
    $newest = $items | Sort-Object -Property @{ Expression = { ConvertTo-UtcDateTime -Value (Get-JsonValue -InputObject $_ -Path 'properties.startTime') } } -Descending | Select-Object -First 1
    return [string]$newest.name
}

function Invoke-Migration {
    <#
    .SYNOPSIS
        Review Focus 3: runs job-migrate with the image just built and stops the deploy unless it succeeds.
    .DESCRIPTION
        The job definition (image, the `sb-jobs db upgrade && sb-jobs site load ...` command) is set by Bicep phase 1, not
        overridden here. A missing job is an ERROR for a real image (never a silent skip). On Failed it waits and retries
        ONCE: that covers AcrPull propagation, and the migration is idempotent. A timeout is not retried (the first run
        may still be going; two concurrent migrations are worse than one failure).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroup,
        [Parameter(Mandatory)][string]$ExpectedImage,
        [int]$TimeoutSeconds = 600,
        [int]$IntervalSeconds = 10,
        [int]$RetryWaitSeconds = 90
    )
    $jobImage = ''
    try {
        $jobImage = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'show', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '--query', 'properties.template.containers[0].image', '-o', 'tsv', '--only-show-errors'))
    }
    catch {
        throw "The migration job '$script:MigrateJobName' cannot be read in resource group '$ResourceGroup'. Phase 1 of the deployment creates it, so a real deploy must not continue without it.`n$($_.Exception.Message)"
    }
    if ([string]::IsNullOrWhiteSpace($jobImage)) { throw "The migration job '$script:MigrateJobName' reports no image. Nothing was started." }
    if ($jobImage -cne $ExpectedImage) {
        throw "The migration job runs '$jobImage' but this deploy built '$ExpectedImage'. Nothing was started: migrating with another image would not match the api you are about to roll out. Re-run Deploy (phase 1 sets the job image)."
    }
    $hint = "ContainerAppConsoleLogs | where ContainerGroupName startswith `"$script:MigrateJobName`" | order by TimeGenerated desc | take 50"
    $attempt = 1
    while ($true) {
        Write-Say "Starting $script:MigrateJobName (attempt $attempt of 2)..."
        $execution = Start-MigrationExecution -ResourceGroup $ResourceGroup
        Write-Say "Execution: $execution (polling every $IntervalSeconds s, up to $TimeoutSeconds s)"
        $outcome = Wait-JobExecution -ResourceGroup $ResourceGroup -Execution $execution -TimeoutSeconds $TimeoutSeconds -IntervalSeconds $IntervalSeconds
        if ($outcome -eq 'Succeeded') {
            Write-Say "Migration $execution Succeeded."
            return $execution
        }
        if ($outcome -eq 'Timeout') {
            throw "Migration $execution did not finish within $TimeoutSeconds s. It may still be running, so it was not retried. Check it in the portal (Container Apps jobs > $script:MigrateJobName > Execution history), then re-run Deploy.`nLog Analytics (a few minutes of delay): $hint"
        }
        if ($attempt -ge 2) {
            throw "Migration $execution Failed twice. Nothing was rolled out.`nLog Analytics (a few minutes of delay): $hint`nIf the log says the image could not be pulled, the AcrPull role assignment has not propagated yet: wait 10 minutes and re-run Deploy."
        }
        Write-Say "Migration $execution Failed. Waiting $RetryWaitSeconds s and retrying once (covers AcrPull propagation; the migration is idempotent)."
        Start-DeployDelay -Seconds $RetryWaitSeconds
        $attempt++
    }
}

function Get-AppSnapshot {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$App, [Parameter(Mandatory)][string]$ResourceGroup)
    $appJson = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', $App, '--resource-group', $ResourceGroup, '-o', 'json', '--only-show-errors')
    $appObject = $appJson | ConvertFrom-Json
    $latest = [string](Get-JsonValue -InputObject $appObject -Path 'properties.latestRevisionName')
    $revision = $null
    if ($latest) {
        $revisionJson = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'revision', 'show', '--name', $App, '--resource-group', $ResourceGroup, '--revision', $latest, '-o', 'json', '--only-show-errors')
        $revision = $revisionJson | ConvertFrom-Json
    }
    return [pscustomobject]@{ Name = $App; App = $appObject; Revision = $revision }
}

function Get-RevisionValue {
    [CmdletBinding()]
    param($Revision, [Parameter(Mandatory)][string]$Path)
    $value = Get-JsonValue -InputObject $Revision -Path "properties.$Path"
    if ($null -eq $value) { $value = Get-JsonValue -InputObject $Revision -Path $Path }
    return $value
}

function Get-GateFailure {
    <#
    .SYNOPSIS
        Review Focus 1: the failing conditions of one app (empty when the gate holds).
    .DESCRIPTION
        A failed single-revision rollout keeps the OLD revision serving, so a green health answer proves nothing. The gate
        therefore requires the latest revision to be the latest READY revision AND to run the image just built; the revision
        must be Provisioned, Running and Healthy with at least one replica. Ingress apps need 100 % traffic; the worker (no
        ingress, no probes) accepts healthState Healthy or None and has no traffic.
        -AllowScaleToZero is for the api in cool mode (minReplicas 0) ONLY: a revision that has 0 replicas is then accepted
        (it is scaled to zero, nothing runs to be Running or Healthy); every other condition holds, and with 1 or more
        replicas Running and Healthy are required again. The real proof for a scaled-to-zero api is the web-to-api smoke call,
        which wakes it. web, a warm api and the alerts worker never get this switch, so for them 0 replicas fails the gate.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Snapshot,
        [Parameter(Mandatory)][string]$ExpectedImage,
        [Parameter(Mandatory)][ValidateSet('Ingress', 'Worker')][string]$Kind,
        [switch]$AllowScaleToZero
    )
    $failures = New-Object System.Collections.Generic.List[string]
    $latest = [string](Get-JsonValue -InputObject $Snapshot.App -Path 'properties.latestRevisionName')
    $ready = [string](Get-JsonValue -InputObject $Snapshot.App -Path 'properties.latestReadyRevisionName')
    $provisioning = [string](Get-JsonValue -InputObject $Snapshot.App -Path 'properties.provisioningState')
    if (-not $latest) {
        $failures.Add('the app has no latest revision')
        return $failures.ToArray()
    }
    if ($provisioning -ne 'Succeeded') { $failures.Add("app provisioningState is '$provisioning', expected Succeeded") }
    if ($ready -ne $latest) { $failures.Add("latestReadyRevisionName is '$ready' but latestRevisionName is '$latest' (the new revision is not ready; an older one may still be serving)") }
    if ($null -eq $Snapshot.Revision) {
        $failures.Add("revision $latest could not be read")
        return $failures.ToArray()
    }
    $image = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'template.containers[0].image')
    if ($image -cne $ExpectedImage) { $failures.Add("revision runs image '$image', expected '$ExpectedImage'") }
    $revisionProvisioning = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'provisioningState')
    if ($revisionProvisioning -ne 'Provisioned') { $failures.Add("revision provisioningState is '$revisionProvisioning', expected Provisioned") }
    $traffic = Get-RevisionValue -Revision $Snapshot.Revision -Path 'trafficWeight'
    if ($Kind -eq 'Ingress' -and ($null -eq $traffic -or [int]$traffic -ne 100)) { $failures.Add("revision trafficWeight is '$traffic', expected 100") }
    $replicas = Get-RevisionValue -Revision $Snapshot.Revision -Path 'replicas'
    if ($AllowScaleToZero -and $Kind -eq 'Ingress' -and $null -ne $replicas -and [int]$replicas -eq 0) { return $failures.ToArray() }
    $running = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'runningState')
    # RunningAtMaxScale is how Container Apps reports a healthy revision whose replica count has reached maxReplicas. web and the
    # alerts worker are pinned at 1 / 1, so a healthy one ALWAYS reads RunningAtMaxScale (seen live on France Central, 2026-11-17);
    # only the api, which may scale 0 to 1, reads plain Running. healthState, replicas, traffic and the image are still checked.
    if ($running -ne 'Running' -and $running -ne 'RunningAtMaxScale') { $failures.Add("revision runningState is '$running', expected Running or RunningAtMaxScale") }
    $health = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'healthState')
    if ($Kind -eq 'Worker') {
        if ($health -ne 'Healthy' -and $health -ne 'None') { $failures.Add("revision healthState is '$health', expected Healthy or None") }
    }
    elseif ($health -ne 'Healthy') { $failures.Add("revision healthState is '$health', expected Healthy") }
    if ($null -eq $replicas -or [int]$replicas -lt 1) { $failures.Add("revision has '$replicas' replicas, expected at least 1") }
    return $failures.ToArray()
}

function Get-AppGateTarget {
    <#
    .SYNOPSIS
        The targets of the revision gate and of the restart, in the order they are restarted: api, alerts, web.
    .DESCRIPTION
        The api of a COOL deployment (minReplicas 0) is marked AllowScaleToZero: 0 replicas is accepted for it, and only for it.
        -ApiOnlyAndWeb is the placeholder deploy, which has no alerts worker (the placeholder api has no database).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiImage,
        [Parameter(Mandatory)][string]$WebImage,
        [Parameter(Mandatory)][string]$ApiMode,
        [switch]$ApiOnlyAndWeb
    )
    $targets = New-Object System.Collections.Generic.List[object]
    $targets.Add(@{ App = 'api'; Kind = 'Ingress'; Image = $ApiImage; AllowScaleToZero = ($ApiMode -eq 'cool') })
    if (-not $ApiOnlyAndWeb) { $targets.Add(@{ App = 'alerts'; Kind = 'Worker'; Image = $ApiImage; AllowScaleToZero = $false }) }
    $targets.Add(@{ App = 'web'; Kind = 'Ingress'; Image = $WebImage; AllowScaleToZero = $false })
    return $targets.ToArray()
}

function Wait-AppGate {
    <# Polls every app until all pass the revision gate, or throws after TimeoutSeconds (counted in poll intervals). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroup,
        [Parameter(Mandatory)][object[]]$Target,
        [int]$TimeoutSeconds = 300,
        [int]$IntervalSeconds = 10
    )
    $waited = 0
    $passed = @{}
    $last = @{}
    while ($true) {
        foreach ($item in $Target) {
            if ($passed.ContainsKey($item.App)) { continue }
            try {
                $snapshot = Get-AppSnapshot -App $item.App -ResourceGroup $ResourceGroup
                $failures = @(Get-GateFailure -Snapshot $snapshot -ExpectedImage $item.Image -Kind $item.Kind -AllowScaleToZero:([bool]$item['AllowScaleToZero']))
            }
            catch {
                $failures = @("could not read the app: $(($_.Exception.Message -split "`n")[0])")
            }
            if ($failures.Count -eq 0) {
                $passed[$item.App] = $true
                Write-Say "PASS gate $($item.App)"
            }
            else {
                $last[$item.App] = $failures
                foreach ($failure in $failures) { Write-Say "WAIT gate $($item.App): $failure" }
            }
        }
        if ($passed.Count -ge @($Target).Count) { return }
        if ($waited -ge $TimeoutSeconds) {
            $open = @($Target | Where-Object { -not $passed.ContainsKey($_.App) } | ForEach-Object { $_.App })
            $detail = ($open | ForEach-Object { "$_ : " + (@($last[$_]) -join '; ') }) -join "`n  "
            throw "Revision gate failed after $TimeoutSeconds s for: $($open -join ', ').`n  $detail`nLook at: az containerapp logs show --name <app> --resource-group $ResourceGroup --type system   and   az containerapp revision list --name <app> --resource-group $ResourceGroup -o table"
        }
        Start-DeployDelay -Seconds $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Get-HttpStatus {
    <# -NoRevoke: curl --ssl-revoke-best-effort (a certificate whose revocation status cannot be fetched is accepted; a revoked one is still refused). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Url, [switch]$NoRevoke)
    $text = ''
    $arguments = @('--silent', '--max-time', '15', '--output', 'NUL', '--write-out', '%{http_code}')
    if ($NoRevoke) { $arguments += '--ssl-revoke-best-effort' }
    try {
        $text = Invoke-Native -FilePath 'curl.exe' -Arguments ($arguments + $Url) -Label 'curl.exe'
    }
    catch { return 0 }
    $code = 0
    if ([int]::TryParse($text, [ref]$code)) { return $code }
    return 0
}

function Wait-HttpOk {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Url, [int]$TimeoutSeconds = 120, [int]$IntervalSeconds = 10, [switch]$NoRevoke)
    $waited = 0
    $status = 0
    while ($true) {
        $status = Get-HttpStatus -Url $Url -NoRevoke:$NoRevoke
        if ($status -eq 200) { return }
        if ($waited -ge $TimeoutSeconds) { throw "GET $Url answered $status after $TimeoutSeconds s, expected 200." }
        Write-Say "  GET $Url answered $status; waiting"
        Start-DeployDelay -Seconds $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Wait-ApiReady {
    <#
    .SYNOPSIS
        Polls GET /api/v1/health/ready THROUGH the web until it answers 200, for up to TimeoutSeconds (5 minutes).
    .DESCRIPTION
        With the api scaled to zero (cool mode) the first request after idle starts a replica: Container Apps holds it until
        the replica is ready (a cold start measured about 30 s locally; longer on Azure, where the image pull comes on
        top). /api/healthz answers from the web alone and says nothing about the api, so the wait that matters goes
        through the web to the api. Says so once, at the first miss.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$WebUrl, [int]$TimeoutSeconds = 300, [int]$IntervalSeconds = 10, [switch]$NoRevoke)
    $url = "$WebUrl/api/v1/health/ready"
    $waited = 0
    $announced = $false
    while ($true) {
        $status = Get-HttpStatus -Url $url -NoRevoke:$NoRevoke
        if ($status -eq 200) { return }
        if (-not $announced) {
            Write-Say '  waiting for the api to start (cold start): a cold start measured about 30 s locally; longer on Azure'
            $announced = $true
        }
        if ($waited -ge $TimeoutSeconds) { throw "GET $url answered $status after $TimeoutSeconds s, expected 200: the api did not start behind the web. Look at: az containerapp logs show --name api --resource-group <rg> --type system" }
        Write-Say "  GET $url answered $status; waiting ($waited s)"
        Start-DeployDelay -Seconds $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Invoke-DemoSmoke {
    <# -Fresh: a just-deployed web app (wait for /api/healthz first, and sleep 62 s at the end so the rate limit H6 drained is clear). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$BaseUrl, [switch]$Fresh, [switch]$NoRevoke)
    $script = Join-Path -Path $script:LibDir -ChildPath 'Test-DemoHttp.ps1'
    $splat = @{ BaseUrl = $BaseUrl }
    if ($Fresh) { $splat['WaitReady'] = $true; $splat['Wait'] = $true }
    if ($NoRevoke) { $splat['NoRevoke'] = $true }
    $global:LASTEXITCODE = 0
    & $script @splat | Out-Host
    return ($LASTEXITCODE -eq 0)
}

function Get-DeployOutput {
    <# webFqdn and apiFqdn of a finished main deployment; the container apps themselves are the fallback. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ResourceGroup, [Parameter(Mandatory)][string]$DeploymentName)
    $webFqdn = ''
    $apiFqdn = ''
    try {
        $outputs = (Invoke-Native -FilePath 'az' -Arguments @('deployment', 'group', 'show', '--resource-group', $ResourceGroup, '--name', $DeploymentName, '--query', 'properties.outputs', '-o', 'json')) | ConvertFrom-Json
        $webFqdn = [string](Get-JsonValue -InputObject $outputs -Path 'webFqdn.value')
        $apiFqdn = [string](Get-JsonValue -InputObject $outputs -Path 'apiFqdn.value')
    }
    catch { Write-Say 'Could not read the deployment outputs; reading the apps instead.' }
    if (-not $webFqdn) {
        $webFqdn = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', 'web', '--resource-group', $ResourceGroup, '--query', 'properties.configuration.ingress.fqdn', '-o', 'tsv', '--only-show-errors'))
    }
    if (-not $webFqdn) { throw 'The web app has no ingress FQDN.' }
    return [pscustomobject]@{ WebFqdn = $webFqdn; ApiFqdn = $apiFqdn }
}

function Invoke-Deploy {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $total = 18
    $state = Read-StateFile
    foreach ($required in 'acrName', 'acrLoginServer', 'appsIdentityId') {
        if (-not (Get-StateValue -State $state -Key $required)) {
            throw "state.json has no '$required': run $(Get-EntryScriptCommand -Arguments '-Action Bootstrap -ContactEmail <your email>') first."
        }
    }
    $secrets = Read-SecretFile
    $registry = Get-StateValue -State $state -Key 'acrLoginServer'
    $placeholder = [bool]$Config.Placeholder
    $noRevoke = [bool]$Config.NoRevoke

    $apiMode = Resolve-ApiMode -Config $Config -State $state

    Write-Say "[1/$total] pre-checks"
    $account = Invoke-DoctorLite -NeedDocker (-not $placeholder)
    $pgVersion = $Config.PostgresVersion
    if (-not $pgVersion) { $pgVersion = Get-StateValue -State $state -Key 'postgresVersion' }
    if (-not $pgVersion) { throw "No PostgreSQL version known. Run $(Get-EntryScriptCommand -Arguments '-Action Doctor') (it picks 18 or 17), or pass -PostgresVersion 17." }
    $deployedVersion = Get-StateValue -State $state -Key 'postgresVersionDeployed'
    if ($deployedVersion -and $deployedVersion -ne $pgVersion) {
        throw "A server of PostgreSQL $deployedVersion already exists from an earlier deploy; $pgVersion would try to change the major version in place, which Azure refuses. Use -PostgresVersion $deployedVersion."
    }

    Write-Say "[2/$total] image tag"
    if ($placeholder) {
        $tagInfo = [pscustomobject]@{ Sha = 'placeholder'; Tag = 'placeholder'; Dirty = $false }
    }
    else {
        $tagInfo = Get-ImageTag -Config $Config
        if ($Config.SkipBuild -and $tagInfo.Dirty) { throw '-SkipBuild needs a clean tree: the tag is the commit, and a dirty tag carries a timestamp that no earlier build has.' }
    }
    $tag = $tagInfo.Tag
    $apiImage = "$registry/sb-api:$tag"
    $webImage = "$registry/sb-web:$tag"
    Write-Say "  subscription : $(Get-JsonValue -InputObject $account -Path 'name')"
    Write-Say "  resource group: $($Config.ResourceGroup) ($($Config.Location))"
    Write-Say "  tag          : $tag"
    if ($placeholder) { Write-Say "  mode         : PLACEHOLDER (public quickstart images; no build, no push, no migration, no alerts worker)" }
    else { Write-Say "  images       : $apiImage and $webImage" }
    Write-Say "  PostgreSQL   : $pgVersion"
    Write-Say "  api mode     : $($apiMode.Mode) (minReplicas $($apiMode.MinReplicas); $($apiMode.Source))"
    if ($placeholder -and (Get-StateValue -State $state -Key 'lastTag') -and (Get-StateValue -State $state -Key 'placeholder') -eq 'False') {
        Write-Say '  WARNING      : a real deployment exists; -Placeholder REPLACES its apps with the public quickstart images (the database is kept).'
    }

    Write-Say "[3/$total] template checks (ADR 0042: the database client must verify the server)"
    Invoke-TemplateTlsCheck -Config $Config
    Write-CostReminder
    if (-not (Confirm-Action -Prompt 'This creates billable Azure resources (see the cost note in infra/README.md).' -Yes $Config.Yes)) {
        throw 'Cancelled by the operator. Nothing was created.'
    }

    if (-not $placeholder) {
        Write-Say "[4/$total] registry login"
        Invoke-Native -FilePath 'az' -Arguments @('acr', 'login', '--name', (Get-StateValue -State $state -Key 'acrName'), '--only-show-errors') | Out-Null
        if ($Config.SkipBuild) {
            Write-Say "[5/$total] -SkipBuild: checking that both images exist in the registry for tag $tag"
            foreach ($repo in @("sb-api:$tag", "sb-web:$tag")) {
                try { Invoke-Native -FilePath 'az' -Arguments @('acr', 'repository', 'show', '--name', (Get-StateValue -State $state -Key 'acrName'), '--image', $repo, '--query', 'name', '-o', 'tsv', '--only-show-errors') | Out-Null }
                catch { throw "Image $repo is not in the registry. Run Deploy without -SkipBuild." }
            }
            Write-Say "[6/$total] root-store check skipped: the image was not built here (it was checked when it was built)"
            Write-Say "[7/$total] nothing to push"
        }
        else {
            Write-Say "[5/$total] building"
            Invoke-ImageBuild -Config $Config -Registry $registry -Tag $tag | Out-Null
            Write-Say "[6/$total] root-store check of the api image (ADR 0042)"
            Test-ApiImageRootStore -Image $apiImage
            Write-Say '  PASS the image trusts both Azure PostgreSQL roots'
            Write-Say "[7/$total] pushing"
            Push-DeployImage -Image @($apiImage, $webImage)
        }
    }
    else {
        Write-Say "[4/$total] to [7/$total] placeholder: no login, build, root-store check or push"
    }

    $baseArgs = @{ Config = $Config; Secrets = $secrets; State = $state; Tag = $tag; PostgresVersion = $pgVersion; ApiImage = $apiImage; WebImage = $webImage }
    Write-Say "[8/$total] phase 1: environment, Postgres and the migration job (Postgres creation takes 5 to 15 minutes; nothing prints until it ends)"
    Invoke-MainDeployment -Config $Config -Name "sb-main-p1-$tag" -ParamValue (Get-MainParamValue @baseArgs -DeployApps $false)
    Save-StateFile -Update @{ postgresVersionDeployed = $pgVersion }

    if ($placeholder) {
        Write-Say "[9/$total] placeholder: no migration"
    }
    else {
        Write-Say "[9/$total] migration (job-migrate runs the image just built)"
        Invoke-Migration -ResourceGroup $Config.ResourceGroup -ExpectedImage $apiImage | Out-Null
    }

    Write-Say "[10/$total] phase 2: the apps"
    Invoke-MainDeployment -Config $Config -Name "sb-main-p2-$tag" -ParamValue (Get-MainParamValue @baseArgs -DeployApps $true)

    Write-Say "[11/$total] database TLS as deployed (ADR 0042)"
    if ($placeholder) { Write-Say '  skipped: a placeholder app has neither the database secret nor the root file' }
    else {
        $tlsResults = @(Test-DeployedTlsSetting -ResourceGroup $Config.ResourceGroup)
        if ((Write-GuardResult -Result $tlsResults) -gt 0) {
            $failed = (@($tlsResults | Where-Object { $_.Status -eq 'FAIL' } | ForEach-Object { $_.Id }) | Select-Object -Unique) -join ', '
            throw "The deployed database TLS check FAILED ($failed, see the FAIL lines above): an app or the job would not verify the database server (ADR 0042). The apps are deployed but were not gated; fix the cause and run Deploy again."
        }
    }

    Write-Say "[12/$total] revision gates (up to 300 s)"
    # The order is the order of the restart below: api and alerts first, together. A cool api (minReplicas 0) may have 0 replicas: it is scaled to zero.
    if ($placeholder) { $targets = @(Get-AppGateTarget -ApiImage $script:PlaceholderImage -WebImage $script:PlaceholderImage -ApiMode $apiMode.Mode -ApiOnlyAndWeb) }
    else { $targets = @(Get-AppGateTarget -ApiImage $apiImage -WebImage $webImage -ApiMode $apiMode.Mode) }
    Wait-AppGate -ResourceGroup $Config.ResourceGroup -Target $targets
    $outputs = Get-DeployOutput -ResourceGroup $Config.ResourceGroup -DeploymentName "sb-main-p2-$tag"
    $webUrl = "https://$($outputs.WebFqdn)"

    # What is deployed NOW, before anything after the gates can fail: Smoke, Status and ResetDemo read this, and after a failed
    # smoke test the advised retry must test THIS deployment. The smoke result is recorded separately and starts as not run.
    # The mode is recorded with the deployment: a later Deploy without -Warm / -Cool keeps it. Its time moves only when it changes.
    $modeAt = Get-StateValue -State $state -Key 'apiModeAt'
    if (-not $modeAt -or (Get-StateValue -State $state -Key 'apiMode') -ne $apiMode.Mode) { $modeAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture) }
    Save-StateFile -Update @{
        lastTag     = $tag
        placeholder = $placeholder
        webFqdn     = $outputs.WebFqdn
        apiFqdn     = $outputs.ApiFqdn
        apiImage    = $(if ($placeholder) { $script:PlaceholderImage } else { $apiImage })
        webImage    = $(if ($placeholder) { $script:PlaceholderImage } else { $webImage })
        apiMode     = $apiMode.Mode
        apiModeAt   = $modeAt
        smokePassed = $false
        smokeAt     = ''
    }

    Write-Say "[13/$total] exposure and cost checks (the api is private and scales per its mode, web and alerts have one replica each, Consumption only, one region)"
    Invoke-PostDeployCheck -Config $Config -Placeholder $placeholder -ApiMode $apiMode.Mode

    Write-Say "[14/$total] restart api, alerts and web back to back (Container Apps makes no revision when only secret values change, so rotated secrets reach running replicas only after a restart; a scaled-to-zero api has nothing to restart)"
    if ($placeholder) { Write-Say '  placeholder: the quickstart apps have no secrets, nothing to restart' }
    else { Restart-DemoApps -ResourceGroup $Config.ResourceGroup -Target $targets }

    Write-Say "[15/$total] new demo epoch, so the replay clock of the smoke test is fresh (the first request wakes a scaled-to-zero api)"
    if ($placeholder) { Write-Say '  placeholder: there is no demo site yet' }
    else {
        Wait-HttpOk -Url "$webUrl/api/healthz" -NoRevoke:$noRevoke
        Wait-ApiReady -WebUrl $webUrl -NoRevoke:$noRevoke
        Reset-DemoEpoch -Config $Config -WebUrl $webUrl -RetryOnRateLimit | Out-Null
    }

    Write-Say "[16/$total] HTTP check"
    if ($placeholder) {
        try {
            Wait-HttpOk -Url "$webUrl/" -NoRevoke:$noRevoke
        }
        catch {
            Save-SmokeResult -Passed $false
            throw
        }
        Save-SmokeResult -Passed $true
        Write-Say "  PASS GET $webUrl/ answered 200 (the demo smoke test is skipped for placeholders)"
    }
    else {
        $smokePassed = $false
        try { $smokePassed = Invoke-DemoSmoke -BaseUrl $webUrl -Fresh -NoRevoke:$noRevoke }
        catch {
            Save-SmokeResult -Passed $false
            throw
        }
        Save-SmokeResult -Passed $smokePassed
        if (-not $smokePassed) {
            throw "The demo HTTP checks failed (see the FAIL lines above). Re-run them with: $(Get-EntryScriptCommand -Arguments '-Action Smoke'). If H3 failed after it created a stop, run $(Get-EntryScriptCommand -Arguments '-Action ResetDemo') to start a clean epoch."
        }
    }

    Write-Say "[17/$total] final demo epoch (a clean epoch and a fresh clock for the first session)"
    if ($placeholder) { Write-Say '  placeholder: there is no demo site yet' }
    else { Reset-DemoEpoch -Config $Config -WebUrl $webUrl -RetryOnRateLimit | Out-Null }

    Write-Say "[18/$total] done"
    Write-Say ''
    Write-Say "Web (public) : $webUrl"
    if ($outputs.ApiFqdn) { Write-Say "Api (INTERNAL, not reachable from the internet; web calls it): https://$($outputs.ApiFqdn)" }
    if ($apiMode.Mode -eq 'warm') { Write-Say "Api mode: warm (one replica always runs; it bills its idle rate). Back to cheap with: $(Get-EntryScriptCommand -Arguments '-Action Cool')" }
    else { Write-Say "Api mode: cool (the api scales to zero when idle; the first request after idle is slow). For a judged session or a recording: $(Get-EntryScriptCommand -Arguments '-Action Warm')" }
    if (-not $placeholder) {
        Write-Say ''
        Write-Say "Demo day: Deploy ended with a new epoch, so the replay day starts at the anchor (10:10 Asia/Dubai) now and lasts $script:DemoDayWindow, whether or not anyone looks. Run ResetDemo before EVERY judged session (it starts a new epoch; it restarts nothing; upstream limit 1 per 60 s and 10 per hour)."
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action ResetDemo') -Why 'before every judged session'
        Write-Say ('  then: ' + (Get-EntryScriptCommand -Arguments '-Action Status') + '   to look again, or   ' + (Get-EntryScriptCommand -Arguments '-Action Teardown') + '   to see how to delete everything.')
    }
    else {
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Deploy') -Why 'the plumbing works; now deploy the real images (the apps are replaced; wait 10 minutes after Bootstrap first)'
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# Status, smoke, teardown
# ---------------------------------------------------------------------------------------------------------------------

function Get-AppEnvValue {
    [CmdletBinding()]
    param($Snapshot, [Parameter(Mandatory)][string]$Name)
    $entries = @(Get-RevisionValue -Revision $Snapshot.Revision -Path 'template.containers[0].env')
    foreach ($entry in $entries) {
        if ($null -ne $entry -and "$($entry.name)" -eq $Name -and $null -ne $entry.PSObject.Properties['value']) { return [string]$entry.value }
    }
    return ''
}

function Invoke-Status {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    Invoke-DoctorLite -NeedDocker $false | Out-Null
    $state = Read-StateFile
    $rg = $Config.ResourceGroup
    Write-Say "Resource group: $rg ($($Config.Location))    last tag: $(Get-StateValue -State $state -Key 'lastTag')"
    Write-Say "Last smoke test: $(Get-SmokeSummary -State $state)"
    $webFqdn = Get-StateValue -State $state -Key 'webFqdn'
    $apiFqdn = Get-StateValue -State $state -Key 'apiFqdn'
    if ($webFqdn) { Write-Say "Web (public) : https://$webFqdn" }
    if ($apiFqdn) { Write-Say "Api (internal): https://$apiFqdn" }
    $expected = @{ api = (Get-StateValue -State $state -Key 'apiImage'); web = (Get-StateValue -State $state -Key 'webImage'); alerts = (Get-StateValue -State $state -Key 'apiImage') }
    $kinds = @{ api = 'Ingress'; web = 'Ingress'; alerts = 'Worker' }
    $mode = Get-ApiModeFromState -State $state
    $modeAt = Get-StateValue -State $state -Key 'apiModeAt'
    if (Get-StateValue -State $state -Key 'apiMode') {
        $shownAt = ''
        if ($modeAt) { $shownAt = " at $modeAt" }
        Write-Say "api mode      : $mode (recorded in state.json$shownAt); change it with -Action Warm or -Action Cool"
    }
    else { Write-Say "api mode      : $mode (the default; no mode recorded yet); change it with -Action Warm or -Action Cool" }
    $snapshots = @{}
    foreach ($app in 'api', 'web', 'alerts') {
        try { $snapshots[$app] = Get-AppSnapshot -App $app -ResourceGroup $rg }
        catch {
            Write-Say "$app : not found ($(($_.Exception.Message -split "`n")[0]))"
            continue
        }
        $snapshot = $snapshots[$app]
        $image = [string](Get-RevisionValue -Revision $snapshot.Revision -Path 'template.containers[0].image')
        $want = $expected[$app]
        if (-not $want) { $want = $image }
        $failures = @(Get-GateFailure -Snapshot $snapshot -ExpectedImage $want -Kind $kinds[$app] -AllowScaleToZero:(($app -eq 'api') -and ($mode -eq 'cool')))
        $replicas = Get-RevisionValue -Revision $snapshot.Revision -Path 'replicas'
        $verdict = 'OK'
        if ($failures.Count -gt 0) { $verdict = 'NOT OK' }
        Write-Say "$app : $verdict  revision=$(Get-JsonValue -InputObject $snapshot.App -Path 'properties.latestRevisionName')  replicas=$replicas"
        Write-Say "       image=$image"
        foreach ($failure in $failures) { Write-Say "       - $failure" }
        if ($app -eq 'api') {
            $minNow = Get-JsonValue -InputObject $snapshot.App -Path 'properties.template.scale.minReplicas'
            $maxNow = Get-JsonValue -InputObject $snapshot.App -Path 'properties.template.scale.maxReplicas'
            $minWant = $script:ApiMinReplicas[$mode]
            if ($null -eq $minNow) { $minNow = 0 }
            if ([int]$minNow -ne $minWant) { Write-Say "       WARN api scale is min $minNow / max $maxNow but the recorded mode is $mode (expected min $minWant): run -Action $(if ($mode -eq 'warm') { 'Warm' } else { 'Cool' }) to bring them together." }
        }
    }
    # The demo day. The clock of api and alerts is the anchor plus the time since the current EPOCH started, and the epoch is a
    # row in the database: Status cannot see it. All it can show is the anchor and the last reset this script recorded.
    if ($snapshots.ContainsKey('api')) {
        $anchor = Get-AppEnvValue -Snapshot $snapshots['api'] -Name 'SB_REPLAY_NOW'
        if (-not $anchor) { $anchor = $script:DefaultReplayNow }
        Write-Say ''
        Write-Say "Replay anchor (SB_REPLAY_NOW): $anchor. The demo day starts there when an epoch starts (Deploy, or ResetDemo) and lasts $script:DemoDayWindow."
        Write-Say 'Status cannot see the epoch (it is a row in the database), so it cannot tell where the clock is now.'
        $epoch = Get-StateValue -State $state -Key 'epochId'
        $resetAt = Get-StateValue -State $state -Key 'resetAt'
        if ($resetAt) {
            $since = $null
            try { $since = (Get-Date).ToUniversalTime() - (ConvertTo-UtcDateTime -Value $resetAt) } catch { $since = $null }
            $shownEpoch = ''
            if ($epoch) { $shownEpoch = "epoch $epoch, " }
            if ($null -ne $since) {
                Write-Say ("Last reset recorded by this script: {0}{1} ({2:N1} h ago)." -f $shownEpoch, $resetAt, $since.TotalHours)
                if ($since.TotalMinutes -gt (7 * 60 + 20)) { Write-Say "WARN more than $script:DemoDayWindow since that reset: the demo day is probably over. Run ResetDemo before the next session." }
            }
            else { Write-Say "Last reset recorded by this script: $shownEpoch$resetAt." }
        }
        else { Write-Say 'This script has recorded no reset yet.' }
    }
    Write-Say ''
    Write-CostReminder
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Teardown') -Why 'when you are done, to see the delete command'
}

function Invoke-Smoke {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $state = Read-StateFile
    $fqdn = Get-StateValue -State $state -Key 'webFqdn'
    if (-not $fqdn) {
        Invoke-DoctorLite -NeedDocker $false | Out-Null
        $fqdn = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', 'web', '--resource-group', $Config.ResourceGroup, '--query', 'properties.configuration.ingress.fqdn', '-o', 'tsv', '--only-show-errors'))
    }
    if (-not $fqdn) { throw 'No web FQDN known. Deploy first.' }
    $url = "https://$fqdn"
    $noRevoke = [bool]$Config.NoRevoke
    if ((Get-StateValue -State $state -Key 'placeholder') -eq 'True') {
        Write-Say 'The last deploy was a placeholder: only GET / is checked.'
        try { Wait-HttpOk -Url "$url/" -TimeoutSeconds 30 -NoRevoke:$noRevoke }
        catch {
            Save-SmokeResult -Passed $false
            throw
        }
        Save-SmokeResult -Passed $true
        Write-Say "PASS GET $url/ answered 200"
        return
    }
    $passed = $false
    try { $passed = Invoke-DemoSmoke -BaseUrl $url -NoRevoke:$noRevoke }
    catch {
        Save-SmokeResult -Passed $false
        throw
    }
    Save-SmokeResult -Passed $passed
    if (-not $passed) { throw 'Demo HTTP checks failed (see the FAIL lines above).' }
    Write-Say 'All demo HTTP checks passed. Note: the last check uses up the rate limit of the demo token for about a minute, and a demo reset is counted in it: wait a minute before ResetDemo.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action ResetDemo') -Why 'before every judged session (the smoke test leaves its own traces in the epoch)'
}

# ---------------------------------------------------------------------------------------------------------------------
# Guards: what deploy.yml checks (ADR 0042 and the exposure and cost checks), as PASS or FAIL lines that stop the deploy
# ---------------------------------------------------------------------------------------------------------------------

function ConvertFrom-AzTsv {
    <# `az -o tsv` prints a JSON null as None and an empty result as nothing: both mean absent, so both become ''. #>
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    if ($Text.Trim() -ieq 'none') { return '' }
    return $Text
}

function New-GuardResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('PASS', 'FAIL', 'SKIP')][string]$Status,
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Subject,
        [string[]]$Reason = @()
    )
    return [pscustomobject]@{ Status = $Status; Id = $Id; Subject = $Subject; Reason = @($Reason) }
}

function Write-GuardResult {
    <# Prints `PASS|FAIL|SKIP <id> <subject>` with the reasons under a FAIL. Returns the number of FAILs. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Result)
    foreach ($item in $Result) {
        Write-Say ('{0} {1} {2}' -f $item.Status, $item.Id, $item.Subject)
        foreach ($reason in $item.Reason) { Write-Say "  - $reason" }
    }
    return @($Result | Where-Object { $_.Status -eq 'FAIL' }).Count
}

function Get-FirstLine {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [int]$Count = 3)
    return @(($Text -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First $Count)
}

# ---- ADR 0042 on the compiled template (T1 T2 T3 of check-db-tls.sh --template) ----------------------------------------

function ConvertTo-ArmText {
    <# One value of a compiled template as text: a string as it is, anything else as compact JSON with apostrophes as Bicep writes them. #>
    [CmdletBinding()]
    param($Value)
    if ($null -eq $Value) { return '' }
    if ($Value -is [string]) { return $Value }
    $apostropheEscape = '\' + 'u0027'
    return ((ConvertTo-Json -InputObject $Value -Compress -Depth 30).Replace($apostropheEscape, "'"))
}

function Get-ArmVariableText {
    [CmdletBinding()]
    param($Variables, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Variables) { return $null }
    $property = $Variables.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ArmRootCertValue {
    <#
    .SYNOPSIS
        Every PGSSLROOTCERT value that an environment expression of a compiled template can reach.
    .DESCRIPTION
        Bicep compiles `var coreEnv = [ { name: 'PGSSLROOTCERT', value: pgSslRootCert } ]` into a variable that holds a JSON
        array, and `concat(coreEnv, ...)` into an expression string that names the variable. This reads the text of the
        expression and then, transitively, the text of every variable it names (so it never needs the parameter values), and
        collects the value of each PGSSLROOTCERT entry: written as a JSON object or built by createObject(...). A value that is
        itself a reference to a string variable is resolved; anything else is returned as it stands, so a mismatch shows.
    #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, $Variables)
    $found = New-Object System.Collections.Generic.List[string]
    $queue = New-Object System.Collections.Generic.Queue[string]
    $seen = New-Object System.Collections.Generic.HashSet[string]
    $queue.Enqueue($Text)
    $resolve = {
        param([string]$Raw)
        $reference = [regex]::Match($Raw, "^\[?variables\('(?<n>[^']+)'\)\]?$")
        if ($reference.Success) {
            $variable = Get-ArmVariableText -Variables $Variables -Name $reference.Groups['n'].Value
            if ($variable -is [string]) { return $variable }
        }
        return $Raw
    }
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $built = "createObject\(\s*'name'\s*,\s*'PGSSLROOTCERT'\s*,\s*'value'\s*,\s*(?:'(?<lit>[^']*)'|variables\('(?<var>[^']+)'\))"
        foreach ($match in [regex]::Matches($current, $built)) {
            if ($match.Groups['lit'].Success) { $found.Add($match.Groups['lit'].Value) }
            else { $found.Add((& $resolve "variables('$($match.Groups['var'].Value)')")) }
        }
        foreach ($match in [regex]::Matches($current, '\{[^{}]*"name"\s*:\s*"PGSSLROOTCERT"[^{}]*\}')) {
            $value = [regex]::Match($match.Value, '"value"\s*:\s*"(?<v>(?:[^"\\]|\\.)*)"')
            if ($value.Success) { $found.Add((& $resolve $value.Groups['v'].Value)) }
        }
        foreach ($match in [regex]::Matches($current, "variables\('(?<n>[^']+)'\)")) {
            $name = $match.Groups['n'].Value
            if ($seen.Add($name)) {
                $variable = Get-ArmVariableText -Variables $Variables -Name $name
                if ($null -ne $variable) { $queue.Enqueue((ConvertTo-ArmText -Value $variable)) }
            }
        }
    }
    return $found.ToArray()
}

function Test-TemplateRootCert {
    <# T3: PGSSLROOTCERT is defined, with the expected path, for api, alerts and job-migrate. Returns the failure reasons. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Template)
    $reasons = New-Object System.Collections.Generic.List[string]
    $variables = Get-JsonValue -InputObject $Template -Path 'variables'
    $resources = Get-JsonValue -InputObject $Template -Path 'resources'
    $items = @()
    if ($resources -is [array]) { $items = $resources }
    elseif ($null -ne $resources) { $items = @($resources.PSObject.Properties | ForEach-Object { $_.Value }) }
    foreach ($target in $script:TlsTargets) {
        $module = @($items | Where-Object { "$(Get-JsonValue -InputObject $_ -Path 'name')" -ceq $target.Module }) | Select-Object -First 1
        if ($null -eq $module) {
            $reasons.Add("$($target.Name): the template has no module deployment named '$($target.Module)'")
            continue
        }
        $envParameter = Get-JsonValue -InputObject $module -Path 'properties.parameters.env'
        if ($null -eq $envParameter) {
            $reasons.Add("$($target.Name): the module has no env parameter")
            continue
        }
        $values = @(Get-ArmRootCertValue -Text (ConvertTo-ArmText -Value $envParameter) -Variables $variables)
        if ($values.Count -eq 0) { $reasons.Add("$($target.Name): PGSSLROOTCERT is not defined for it") }
        else {
            foreach ($value in ($values | Select-Object -Unique)) {
                if ($value -cne $script:ExpectedRootCert) { $reasons.Add("$($target.Name): PGSSLROOTCERT is '$value', expected $($script:ExpectedRootCert)") }
            }
        }
    }
    return $reasons.ToArray()
}

function Get-TemplateTlsResult {
    <#
    .SYNOPSIS
        T1 T2 T3 of check-db-tls.sh --template, on the text of the compiled infra/bicep/main.bicep (no Azure, no secret).
    .DESCRIPTION
        T1 every database URL in the template has ssl=verify-full, and there is one. T2 no weaker ssl mode (require, prefer,
        allow, disable, false) and no sslmode= anywhere. T3 PGSSLROOTCERT is defined for api, alerts and job-migrate with the
        expected path. T1 and T2 are the same text searches as template_checks.py. T3 reads the compiled expressions (see
        Get-ArmRootCertValue) where template_checks.py evaluates the template with dummy parameters; it is therefore a check
        that the entry is reachable, and T5 proves the deployed value.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$TemplateJson)
    $results = New-Object System.Collections.Generic.List[object]

    $urls = @([regex]::Matches($TemplateJson, 'postgres(?:ql)?(?:\+\w+)?://[^"\\]*') | ForEach-Object { $_.Value })
    $weakUrls = @($urls | Where-Object { -not $_.Contains('ssl=verify-full') })
    $subject = 'the database URL secret expression contains ssl=verify-full'
    if ($urls.Count -eq 0) { $results.Add((New-GuardResult -Status FAIL -Id 'T1' -Subject $subject -Reason @('no database URL found in the template'))) }
    elseif ($weakUrls.Count -gt 0) {
        $reasons = @($weakUrls | ForEach-Object { "a database URL lacks ssl=verify-full (it ends ...$($_.Substring([math]::Max(0, $_.Length - 24))))" })
        $results.Add((New-GuardResult -Status FAIL -Id 'T1' -Subject $subject -Reason $reasons))
    }
    else { $results.Add((New-GuardResult -Status PASS -Id 'T1' -Subject $subject)) }

    $weak = @([regex]::Matches($TemplateJson, 'ssl=(?:require|prefer|allow|disable|false)|sslmode=', 'IgnoreCase') | ForEach-Object { $_.Value.ToLowerInvariant() } | Select-Object -Unique)
    $subject = 'no weaker ssl mode and no sslmode= anywhere in the template'
    if ($weak.Count -gt 0) { $results.Add((New-GuardResult -Status FAIL -Id 'T2' -Subject $subject -Reason @("the template contains $($weak -join ', ')"))) }
    else { $results.Add((New-GuardResult -Status PASS -Id 'T2' -Subject $subject)) }

    $subject = 'PGSSLROOTCERT is defined for api, alerts and job-migrate'
    try {
        $template = $TemplateJson | ConvertFrom-Json
        $reasons = @(Test-TemplateRootCert -Template $template)
    }
    catch { $reasons = @("cannot evaluate: $(($_.Exception.Message -split "`n")[0])") }
    if ($reasons.Count -gt 0) { $results.Add((New-GuardResult -Status FAIL -Id 'T3' -Subject $subject -Reason $reasons)) }
    else { $results.Add((New-GuardResult -Status PASS -Id 'T3' -Subject $subject)) }
    return $results.ToArray()
}

function Invoke-TemplateTlsCheck {
    <# Builds main.bicep with `az bicep build --stdout`, prints T1 T2 T3 and throws on any FAIL (nothing is built or created yet). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $file = Join-Path -Path $Config.RepoRoot -ChildPath 'infra\bicep\main.bicep'
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing $file. Run this from a checkout of the feat/i1-azure-infra branch." }
    try {
        $json = Invoke-Native -FilePath 'az' -Arguments @('bicep', 'build', '--file', $file, '--stdout')
    }
    catch {
        Write-GuardResult -Result @(New-GuardResult -Status FAIL -Id 'T0' -Subject 'main.bicep builds' -Reason (Get-FirstLine -Text $_.Exception.Message)) | Out-Null
        throw "main.bicep does not build, so the template checks could not run. Nothing was built or created. Install or repair Bicep with: az bicep install"
    }
    $results = @(Get-TemplateTlsResult -TemplateJson $json)
    if ((Write-GuardResult -Result $results) -gt 0) {
        $ids = (@($results | Where-Object { $_.Status -eq 'FAIL' } | ForEach-Object { $_.Id }) -join ', ')
        throw "Template checks FAILED ($ids): the database client would not verify the server, or an app would lack the root file (ADR 0042). Nothing was built or created."
    }
}

# ---- ADR 0042 on what was deployed (T4 T5 of check-db-tls.sh --deployed) -------------------------------------------------

function Test-DeployedTlsSetting {
    <#
    .SYNOPSIS
        T4: the stored sb-database-url secret of api, alerts and job-migrate has ssl=verify-full. T5: each one's PGSSLROOTCERT
        environment entry has the expected path. Catches a secret or an entry changed outside the template.
    .DESCRIPTION
        The secret is read with `secret list --show-values` (`secret show` does not print a value), held in one local variable
        only long enough to search it, and never printed, stored or put in a message: the errors of Invoke-Native name the
        command and show masked stderr, never an argument or stdout.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ResourceGroup)
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($target in $script:TlsTargets) {
        $name = $target.Name
        $jobWord = @()
        if ($target.Kind -eq 'job') { $jobWord = @('job') }

        $secretOk = $false
        $secretReason = @()
        try {
            $secretArguments = @('containerapp') + $jobWord + @('secret', 'list', '--name', $name, '--resource-group', $ResourceGroup, '--show-values', '--query', "[?name=='$($script:DatabaseUrlSecretName)'].value | [0]", '-o', 'tsv', '--only-show-errors')
            $stored = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments $secretArguments)
            $secretOk = $stored.Contains('ssl=verify-full')
            $stored = $null
        }
        catch { $secretReason = @(Get-FirstLine -Text $_.Exception.Message -Count 2) }
        if ($secretOk) { $results.Add((New-GuardResult -Status PASS -Id 'T4' -Subject "$name stores $($script:DatabaseUrlSecretName) with ssl=verify-full")) }
        else { $results.Add((New-GuardResult -Status FAIL -Id 'T4' -Subject "${name}: $($script:DatabaseUrlSecretName) is missing, unreadable, or lacks ssl=verify-full" -Reason $secretReason)) }

        $found = ''
        $certReason = @()
        try {
            $certArguments = @('containerapp') + $jobWord + @('show', '--name', $name, '--resource-group', $ResourceGroup, '--query', "properties.template.containers[0].env[?name=='PGSSLROOTCERT'].value | [0]", '-o', 'tsv', '--only-show-errors')
            $found = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments $certArguments)
        }
        catch { $certReason = @(Get-FirstLine -Text $_.Exception.Message -Count 2) }
        if ($found -ceq $script:ExpectedRootCert) { $results.Add((New-GuardResult -Status PASS -Id 'T5' -Subject "$name has PGSSLROOTCERT=$($script:ExpectedRootCert)")) }
        else {
            $shown = $found
            if (-not $shown) { $shown = '<unset>' }
            $results.Add((New-GuardResult -Status FAIL -Id 'T5' -Subject "${name}: PGSSLROOTCERT is '$shown', expected $($script:ExpectedRootCert)" -Reason $certReason))
        }
    }
    return $results.ToArray()
}

# ---- exposure and cost (S1 S2 S4 S6 of smoke.sh) -------------------------------------------------------------------------

function Test-WorkloadProfile {
    <# S1 (cost): the environment's workload profiles are exactly one, Consumption (a Dedicated profile is billed while idle). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Name, $Environment)
    $value = Get-JsonValue -InputObject $Environment -Path 'properties.workloadProfiles'
    $profiles = @()
    if ($null -ne $value) { $profiles = @($value) }
    $shown = @($profiles | ForEach-Object { "$(Get-JsonValue -InputObject $_ -Path 'name')/$(Get-JsonValue -InputObject $_ -Path 'workloadProfileType')" })
    if ($profiles.Count -eq 1 -and "$(Get-JsonValue -InputObject $profiles[0] -Path 'name')" -ceq 'Consumption' -and "$(Get-JsonValue -InputObject $profiles[0] -Path 'workloadProfileType')" -ceq 'Consumption') {
        return (New-GuardResult -Status PASS -Id 'S1' -Subject "environment $Name has only the Consumption profile")
    }
    if ($shown.Count -eq 0) { $shown = @('none') }
    return (New-GuardResult -Status FAIL -Id 'S1' -Subject "environment $Name workload profiles are [$($shown -join ', ')], expected exactly Consumption" -Reason @('a Dedicated profile is billed while idle'))
}

function Test-NoPrivateEndpoint {
    <# S1 (cost): the group has no private endpoint (each adds a USD 0.10/h meter). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Resource)
    $endpoints = @($Resource | Where-Object { "$(Get-JsonValue -InputObject $_ -Path 'type')" -ieq 'Microsoft.Network/privateEndpoints' } | ForEach-Object { "$(Get-JsonValue -InputObject $_ -Path 'name')" })
    if ($endpoints.Count -eq 0) { return (New-GuardResult -Status PASS -Id 'S1' -Subject 'the group has no private endpoint') }
    return (New-GuardResult -Status FAIL -Id 'S1' -Subject 'the group has a private endpoint' -Reason @("$($endpoints -join ', ') (each adds a USD 0.10/h meter)"))
}

function Test-AppScale {
    <#
    .SYNOPSIS
        S2 (cost): the scale of an app is the expected min / max (default 1 / 1: web, and a warm api; a cool api is 0 / 1).
    .DESCRIPTION
        A scale block without minReplicas means 0, the Container Apps default. A missing scale block, or a missing
        maxReplicas, is a FAIL: nothing can be said about what the app costs.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Name, $App, [int]$ExpectedMin = 1, [int]$ExpectedMax = 1)
    $scale = Get-JsonValue -InputObject $App -Path 'properties.template.scale'
    $min = Get-JsonValue -InputObject $App -Path 'properties.template.scale.minReplicas'
    $max = Get-JsonValue -InputObject $App -Path 'properties.template.scale.maxReplicas'
    if ($null -ne $scale -and $null -eq $min) { $min = 0 }
    if ($null -ne $min -and $null -ne $max -and [int]$min -eq $ExpectedMin -and [int]$max -eq $ExpectedMax) {
        return (New-GuardResult -Status PASS -Id 'S2' -Subject "$Name scale is min $ExpectedMin / max $ExpectedMax")
    }
    $shownMin = '?'
    $shownMax = '?'
    if ($null -ne $min) { $shownMin = "$min" }
    if ($null -ne $max) { $shownMax = "$max" }
    return (New-GuardResult -Status FAIL -Id 'S2' -Subject "$Name scale is min $shownMin / max $shownMax, expected $ExpectedMin / $ExpectedMax")
}

function Test-AppIngress {
    <# S4 (exposure): api ingress is internal, web is external, alerts has no ingress at all. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateSet('api', 'web', 'alerts')][string]$Name, $App)
    $ingress = Get-JsonValue -InputObject $App -Path 'properties.configuration.ingress'
    $external = Get-JsonValue -InputObject $ingress -Path 'external'
    $shown = 'unreadable'
    if ($external -is [bool]) { $shown = "$external".ToLowerInvariant() }
    switch ($Name) {
        'api' {
            if ($external -is [bool] -and -not $external) { return (New-GuardResult -Status PASS -Id 'S4' -Subject 'api ingress is internal (not public)') }
            return (New-GuardResult -Status FAIL -Id 'S4' -Subject "api ingress.external is '$shown', expected false" -Reason @('the api must not be public'))
        }
        'web' {
            if ($external -is [bool] -and $external) { return (New-GuardResult -Status PASS -Id 'S4' -Subject 'web ingress is external') }
            return (New-GuardResult -Status FAIL -Id 'S4' -Subject "web ingress.external is '$shown', expected true")
        }
        default {
            if ($null -eq $ingress) { return (New-GuardResult -Status PASS -Id 'S4' -Subject 'alerts has no ingress') }
            return (New-GuardResult -Status FAIL -Id 'S4' -Subject "alerts has an ingress (external=$shown), expected none")
        }
    }
}

function Test-ResourceLocation {
    <# S6: every resource of the group is in the expected region (a display name such as UAE North matches uaenorth). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Resource, [Parameter(Mandatory)][string]$Location)
    if ($Resource.Count -eq 0) { return (New-GuardResult -Status FAIL -Id 'S6' -Subject 'no resource is listed in the group, so the region cannot be confirmed') }
    $want = ConvertTo-LocationKey -Text $Location
    $misplaced = @($Resource | Where-Object { (ConvertTo-LocationKey -Text "$(Get-JsonValue -InputObject $_ -Path 'location')") -ne $want } | ForEach-Object { "$(Get-JsonValue -InputObject $_ -Path 'name') ($(Get-JsonValue -InputObject $_ -Path 'location'))" })
    if ($misplaced.Count -eq 0) { return (New-GuardResult -Status PASS -Id 'S6' -Subject "all $($Resource.Count) resources are in $Location") }
    return (New-GuardResult -Status FAIL -Id 'S6' -Subject "resources outside ${Location}" -Reason @($misplaced))
}

function Read-AzJson {
    <# `az ... -o json` parsed, or $null when the command fails (the caller turns that into a FAIL). #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string[]]$Argument)
    try { return ((Invoke-Native -FilePath 'az' -Arguments $Argument) | ConvertFrom-Json) }
    catch { return $null }
}

function Invoke-PostDeployCheck {
    <# S1 S2 S4 S6 after the gates: prints every result and throws when any is a FAIL. The apps are deployed by then. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][bool]$Placeholder, [ValidateSet('cool', 'warm')][string]$ApiMode = 'cool')
    $rg = $Config.ResourceGroup
    $results = New-Object System.Collections.Generic.List[object]

    $environmentText = ''
    try { $environmentText = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'env', 'list', '--resource-group', $rg, '--query', '[].name', '-o', 'tsv', '--only-show-errors')) }
    catch { $environmentText = '' }
    $environmentNames = @(($environmentText -split "`n") | ForEach-Object { ConvertFrom-AzTsv -Text $_ } | Where-Object { $_ })
    if ($environmentNames.Count -eq 0) { $results.Add((New-GuardResult -Status FAIL -Id 'S1' -Subject "no Container Apps environment found in $rg")) }
    foreach ($environmentName in $environmentNames) {
        $environment = Read-AzJson -Argument @('containerapp', 'env', 'show', '--name', $environmentName, '--resource-group', $rg, '-o', 'json', '--only-show-errors')
        $results.Add((Test-WorkloadProfile -Name $environmentName -Environment $environment))
    }

    $resources = Read-AzJson -Argument @('resource', 'list', '--resource-group', $rg, '--query', '[].{name:name,type:type,location:location}', '-o', 'json', '--only-show-errors')
    $resourceList = @()
    if ($null -ne $resources) { $resourceList = @($resources | ForEach-Object { $_ }) }
    $results.Add((Test-NoPrivateEndpoint -Resource $resourceList))

    # web and the alerts worker are always min 1 / max 1; the api is min 0 (cool) or 1 (warm) and max 1.
    $apiMin = [int]$script:ApiMinReplicas[$ApiMode]
    $apps = @('api', 'web')
    if (-not $Placeholder) { $apps += 'alerts' }
    foreach ($app in $apps) {
        $document = Read-AzJson -Argument @('containerapp', 'show', '--name', $app, '--resource-group', $rg, '-o', 'json', '--only-show-errors')
        if ($null -eq $document) {
            $results.Add((New-GuardResult -Status FAIL -Id 'S2' -Subject "${app}: the app cannot be read"))
            if (-not $Placeholder) { $results.Add((New-GuardResult -Status FAIL -Id 'S4' -Subject "${app}: the app cannot be read")) }
            continue
        }
        if ($app -eq 'api') { $results.Add((Test-AppScale -Name $app -App $document -ExpectedMin $apiMin -ExpectedMax 1)) }
        else { $results.Add((Test-AppScale -Name $app -App $document -ExpectedMin 1 -ExpectedMax 1)) }
        if (-not $Placeholder) { $results.Add((Test-AppIngress -Name $app -App $document)) }
    }
    if ($Placeholder) { $results.Add((New-GuardResult -Status SKIP -Id 'S4' -Subject 'placeholder: the ingress of the quickstart apps is not checked')) }
    $results.Add((Test-ResourceLocation -Resource $resourceList -Location $Config.Location))

    if ((Write-GuardResult -Result $results.ToArray()) -gt 0) {
        $ids = (@($results | Where-Object { $_.Status -eq 'FAIL' } | ForEach-Object { $_.Id }) | Select-Object -Unique) -join ', '
        throw "Post-deploy checks FAILED ($ids): see the FAIL lines above. The apps are deployed; do not hand out the URL until this is fixed. Fix it and run Deploy again, or delete everything (Teardown prints the command)."
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# Restart of the apps, and the demo epoch (ResetDemo)
# ---------------------------------------------------------------------------------------------------------------------

function Restart-DemoApps {
    <#
    .SYNOPSIS
        Restarts the active revision of every target back to back, then waits for the revision gate again.
    .DESCRIPTION
        Container Apps creates no revision when only the VALUES of secrets change, so rotated secrets reach running replicas
        only after a restart. All restarts are issued before the first wait. Every target is a hashtable of App, Kind, Image and
        optionally AllowScaleToZero (the same targets Wait-AppGate takes), in the order they are restarted: api, alerts, web.
        A target marked AllowScaleToZero (the api in cool mode) that has 0 replicas is NOT restarted: nothing runs, and its
        next cold start reads the secrets. The alerts worker always runs one replica, so it is always restarted.
    #>
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseSingularNouns', '', Justification = 'It restarts a set of apps; the name was agreed with the other deploy lanes.')]
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ResourceGroup, [Parameter(Mandatory)][object[]]$Target)
    $revisions = [ordered]@{}
    foreach ($item in $Target) {
        $snapshot = Get-AppSnapshot -App $item.App -ResourceGroup $ResourceGroup
        $replicas = Get-RevisionValue -Revision $snapshot.Revision -Path 'replicas'
        if ([bool]$item['AllowScaleToZero'] -and $null -ne $replicas -and [int]$replicas -eq 0) {
            Write-Say "  $($item.App) has 0 replicas: not restarted (it reads its secrets at the next cold start)"
            continue
        }
        $revisions[$item.App] = [string](Get-JsonValue -InputObject $snapshot.App -Path 'properties.latestRevisionName')
    }
    foreach ($app in $revisions.Keys) {
        Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'revision', 'restart', '--name', $app, '--resource-group', $ResourceGroup, '--revision', $revisions[$app], '--only-show-errors', '-o', 'none') | Out-Null
    }
    Start-DeployDelay -Seconds 15
    Write-Say 'Waiting for every restarted app to pass the revision gate again (up to 300 s)...'
    Wait-AppGate -ResourceGroup $ResourceGroup -Target $Target
}

function ConvertFrom-CurlResponse {
    <# The text of `curl.exe --include --write-out "\n%{http_code}"`: status, the headers of the final response, and its body. #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text)
    $lines = @($Text -split "`n")
    $status = 0
    if ($lines.Count -gt 0 -and -not [int]::TryParse($lines[$lines.Count - 1].Trim(), [ref]$status)) { $status = 0 }
    $response = @()
    if ($lines.Count -gt 1) { $response = @($lines[0..($lines.Count - 2)]) }
    $start = -1
    for ($i = 0; $i -lt $response.Count; $i++) { if ($response[$i] -match '^HTTP/\d') { $start = $i } }
    $headers = @()
    $body = ''
    if ($start -ge 0) {
        $end = $start + 1
        while ($end -lt $response.Count -and $response[$end].Trim() -ne '') { $end++ }
        if ($end -gt $start + 1) { $headers = @($response[($start + 1)..($end - 1)] | Where-Object { $_ }) }
        if ($end + 1 -lt $response.Count) { $body = ($response[($end + 1)..($response.Count - 1)] -join "`n") }
    }
    else { $body = ($response -join "`n") }
    $retry = ''
    foreach ($header in $headers) { if ($header -match '^retry-after:\s*(?<v>.*?)\s*$') { $retry = $Matches['v'] } }
    return [pscustomobject]@{ Status = $status; Headers = $headers; RetryAfter = $retry; Body = $body.Trim() }
}

function Invoke-DemoResetRequest {
    <# POST /api/v1/sites/site-demo-mussafah/demo-reset through the web (the BFF injects the demo token). Never throws on an HTTP answer. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$WebUrl, [switch]$NoRevoke)
    $arguments = New-Object System.Collections.Generic.List[string]
    # --max-time 180: room for the first request after idle to wake a scaled-to-zero api (a cold start measured about 30 s locally; longer on Azure).
    foreach ($item in @('--silent', '--show-error', '--max-time', '180', '--request', 'POST', '--header', 'Content-Length: 0', '--include', '--write-out', '\n%{http_code}')) { $arguments.Add($item) }
    if ($NoRevoke) { $arguments.Add('--ssl-revoke-best-effort') }
    $arguments.Add("$WebUrl/api/v1/sites/$($script:DemoSiteId)/demo-reset")
    try { $text = Invoke-Native -FilePath 'curl.exe' -Arguments $arguments.ToArray() -Label 'curl.exe (demo-reset)' }
    catch { return [pscustomobject]@{ Status = 0; Headers = @(); RetryAfter = ''; Body = ''; Error = (Get-FirstLine -Text $_.Exception.Message -Count 2) -join ' ' } }
    $parsed = ConvertFrom-CurlResponse -Text $text
    return [pscustomobject]@{ Status = $parsed.Status; Headers = $parsed.Headers; RetryAfter = $parsed.RetryAfter; Body = $parsed.Body; Error = '' }
}

function Reset-DemoEpoch {
    <#
    .SYNOPSIS
        Starts a new epoch of the demo site and records it in state.json. Throws unless the answer is 2xx.
    .DESCRIPTION
        A reset starts a NEW epoch: the demo day restarts at the SB_REPLAY_NOW anchor (the clock of api and alerts is the anchor
        plus the time since the epoch started, read from the database, so the two always agree) and lasts about 7 h 20 min.
        Stops, sign-offs and push subscriptions belong to the epoch, so a reset drops them. Nothing is deleted and no process is
        restarted. Rate limits upstream: 1 per 60 s and 10 per hour; the general bucket of the web is charged too. A 429 fails
        with its Retry-After, unless -RetryOnRateLimit: then a short Retry-After is waited out ONCE and the request is repeated.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$WebUrl, [switch]$RetryOnRateLimit)
    $attempt = 1
    while ($true) {
        Write-Say "POST $WebUrl/api/v1/sites/$($script:DemoSiteId)/demo-reset"
        $answer = Invoke-DemoResetRequest -WebUrl $WebUrl -NoRevoke:([bool]$Config.NoRevoke)
        if ($answer.Status -ge 200 -and $answer.Status -lt 300) { break }
        if ($answer.Status -eq 0) { throw "demo-reset got no HTTP answer ($($answer.Error)). Nothing was changed that this script knows of. Check the web app, then run: $(Get-EntryScriptCommand -Arguments '-Action ResetDemo')" }
        if ($answer.Status -ne 429) { throw "demo-reset answered HTTP $($answer.Status), expected 200. The demo clock was not restarted. Look at the web and api logs, then run: $(Get-EntryScriptCommand -Arguments '-Action ResetDemo')" }
        $seconds = 0
        $known = [int]::TryParse($answer.RetryAfter, [ref]$seconds)
        $shown = 'none'
        if ($answer.RetryAfter) { $shown = "$($answer.RetryAfter) s" }
        if ($RetryOnRateLimit -and $attempt -lt 2 -and ($known -or -not $answer.RetryAfter) -and $seconds -le 120) {
            if (-not $known) { $seconds = 60 }
            Write-Say "demo-reset answered 429 (rate limited; Retry-After $shown). Waiting $seconds s and trying once more."
            Start-DeployDelay -Seconds $seconds
            $attempt++
            continue
        }
        throw "demo-reset answered 429: it is rate limited (1 per 60 s and 10 per hour upstream, and the general bucket of the web is charged too). Retry-After: $shown. Run $(Get-EntryScriptCommand -Arguments '-Action ResetDemo') again after that."
    }
    $epoch = ''
    $previous = ''
    $resetAt = ''
    try {
        $document = $answer.Body | ConvertFrom-Json
        $epoch = "$(Get-JsonValue -InputObject $document -Path 'epoch_id')"
        $previous = "$(Get-JsonValue -InputObject $document -Path 'previous_epoch_id')"
        # PowerShell 7 turns an ISO date into a DateTime, Windows PowerShell 5.1 keeps the string.
        $rawResetAt = Get-JsonValue -InputObject $document -Path 'reset_at'
        if ($rawResetAt -is [datetime]) { $resetAt = $rawResetAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture) }
        elseif ($null -ne $rawResetAt) { $resetAt = [string]$rawResetAt }
    }
    catch { Write-Say 'The answer was not JSON; the epoch ids are not recorded.' }
    if (-not $resetAt) { $resetAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture) }
    if ($epoch) {
        $line = "Demo reset: epoch $epoch started"
        if ($previous) { $line += " (the epoch before was $previous)" }
        Write-Say "$line at $resetAt."
    }
    else { Write-Say "Demo reset answered 200 at $resetAt but the answer has no epoch_id, so no epoch is recorded." }
    Write-Say "The demo day restarts at the replay anchor (SB_REPLAY_NOW, 10:10 Asia/Dubai) and lasts $script:DemoDayWindow. Stops, sign-offs and push subscriptions of the earlier epoch no longer show."
    Save-StateFile -Update @{ epochId = $epoch; previousEpochId = $previous; resetAt = $resetAt }
    return [pscustomobject]@{ EpochId = $epoch; PreviousEpochId = $previous; ResetAt = $resetAt }
}

function Invoke-ResetDemo {
    <#
    -Action ResetDemo: a new demo epoch through the web, before every judged session. Restarts nothing.
    -RetryOnRateLimit: a 429 with a short Retry-After is waited out ONCE (Warm and Deploy use it: a smoke test a minute ago
    drained the web's general bucket, which the reset draws on). -NoNext: the caller prints the closing "Next:" itself.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [switch]$RetryOnRateLimit, [switch]$NoNext)
    $state = Read-StateFile
    if ((Get-StateValue -State $state -Key 'placeholder') -eq 'True') {
        Write-Say 'The last deploy was a placeholder: there is no demo site and no demo day (no real api yet). Nothing to reset.'
        return
    }
    $fqdn = Get-StateValue -State $state -Key 'webFqdn'
    if (-not $fqdn) {
        Invoke-DoctorLite -NeedDocker $false | Out-Null
        $fqdn = ConvertFrom-AzTsv -Text (Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', 'web', '--resource-group', $Config.ResourceGroup, '--query', 'properties.configuration.ingress.fqdn', '-o', 'tsv', '--only-show-errors'))
    }
    if (-not $fqdn) { throw 'No web FQDN known. Deploy first.' }
    Reset-DemoEpoch -Config $Config -WebUrl "https://$fqdn" -RetryOnRateLimit:$RetryOnRateLimit | Out-Null
    Write-Say 'Nothing was restarted: the clock of api and alerts follows the epoch, which the database holds.'
    if (-not $NoNext) { Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Status') -Why 'look at the apps again' }
}

function Invoke-ApiMode {
    <#
    .SYNOPSIS
        -Action Warm / -Action Cool: sets the scale of the RUNNING api, gates it, and records the mode in state.json.
    .DESCRIPTION
        Warm = minReplicas 1 (one replica always runs: no cold start; for judged sessions and recordings; it bills the api's
        idle rate while warm). Cool = minReplicas 0 (the api scales to zero when idle: the cheap default; the first request
        after idle is slow). Both keep maxReplicas 1. A scale change makes a new revision, so the revision gate runs after it:
        warm with the WARM rules (a replica must run and be Healthy), cool with the COOL rules (0 replicas is accepted). The
        app is then read back and its scale must be what was asked for. Warm then runs one demo reset (a warm session starts
        with a fresh epoch; a 429 is waited out once, as in Deploy). Only after all of that is the mode recorded, so a failure
        leaves the recorded mode as it was; a failure of the reset says that the api is already at the new scale.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Mode)
    if (-not $script:ApiMinReplicas.ContainsKey($Mode)) { throw "The api mode must be warm or cool, not '$Mode'." }
    Invoke-DoctorLite -NeedDocker $false | Out-Null
    $state = Read-StateFile
    $rg = $Config.ResourceGroup
    $min = [int]$script:ApiMinReplicas[$Mode]
    $image = Get-StateValue -State $state -Key 'apiImage'
    if (-not $image) {
        $current = Get-AppSnapshot -App 'api' -ResourceGroup $rg
        $image = [string](Get-RevisionValue -Revision $current.Revision -Path 'template.containers[0].image')
    }
    Write-Say "Setting the api to $Mode in $rg : minReplicas $min, maxReplicas 1."
    Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'update', '--name', 'api', '--resource-group', $rg, '--min-replicas', "$min", '--max-replicas', '1', '--only-show-errors', '-o', 'none') | Out-Null
    Write-Say "Gate: the new api revision must be ready on the image that is deployed ($Mode rules, up to 300 s)..."
    Wait-AppGate -ResourceGroup $rg -Target @(@{ App = 'api'; Kind = 'Ingress'; Image = $image; AllowScaleToZero = ($Mode -eq 'cool') })
    $readBack = Get-AppSnapshot -App 'api' -ResourceGroup $rg
    $scale = Test-AppScale -Name 'api' -App $readBack.App -ExpectedMin $min -ExpectedMax 1
    Write-GuardResult -Result @($scale) | Out-Null
    if ($scale.Status -ne 'PASS') {
        throw "S2 $($scale.Subject): the app does not show the scale that was asked for, so the mode was NOT recorded (the recorded mode is still $(Get-ApiModeFromState -State $state)). Look at: az containerapp show --name api --resource-group $rg --query properties.template.scale"
    }
    if ($Mode -eq 'warm') {
        # The reset comes BEFORE the mode is recorded, and retries once on a 429: right after a smoke test the web's general
        # bucket is drained (H6) and the reset draws on it. The scale is already changed here, so a reset that still fails says so.
        Write-Say 'A warm session starts with one demo reset (a new epoch, a fresh replay day); the mode is recorded once it has worked:'
        try { Invoke-ResetDemo -Config $Config -RetryOnRateLimit -NoNext }
        catch {
            throw "The api IS warm now (the scale was changed and checked) but the demo reset failed, so the mode was NOT recorded (it is still $(Get-ApiModeFromState -State $state)). $($_.Exception.Message)`nRun $(Get-EntryScriptCommand -Arguments '-Action Warm') again when the reset can succeed (safe to repeat; it records the mode). $(Get-EntryScriptCommand -Arguments '-Action ResetDemo') alone retries only the reset and does not record the mode."
        }
    }
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    Save-StateFile -Update @{ apiMode = $Mode; apiModeAt = $now }
    if ($Mode -eq 'warm') {
        Write-Say "The api is warm (recorded at $now): one replica always runs, so there is no cold start."
        Write-Say 'Use warm for judged sessions and for recording. It bills the idle rate of the api while it is warm, so go back to cool when the session is over.'
        Write-Say "Back to cheap with: $(Get-EntryScriptCommand -Arguments '-Action Cool')"
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Status') -Why 'look at the apps again'
    }
    else {
        Write-Say "The api is cool (recorded at $now): it now scales to zero when idle, and the first request after idle is slow (a cold start measured about 30 s locally; longer on Azure)."
        Write-Say "Before a judged session or a recording: $(Get-EntryScriptCommand -Arguments '-Action Warm')"
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Status') -Why 'look at the apps again'
    }
}

function Get-SmokeSummary {
    <# One line for Status: did the last smoke test pass, and when. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$State)
    $at = Get-StateValue -State $State -Key 'smokeAt'
    if (-not $at) { return 'not run yet for the last deploy' }
    if ((Get-StateValue -State $State -Key 'smokePassed') -eq 'True') { return "passed at $at" }
    return "FAILED at $at"
}

function Save-SmokeResult {
    [CmdletBinding()]
    param([Parameter(Mandatory)][bool]$Passed)
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    Save-StateFile -Update @{ smokePassed = $Passed; smokeAt = $now }
}

function Get-WhatIfSummary {
    <# Counts of the change types in a `what-if --result-format ResourceIdOnly -o json` answer. Only ids and change types are read. #>
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Json)
    $summary = [ordered]@{ Create = 0; Modify = 0; Delete = 0; NoChange = 0; Other = 0 }
    if ([string]::IsNullOrWhiteSpace($Json)) { return $summary }
    $document = $Json | ConvertFrom-Json
    $changes = @(Get-JsonValue -InputObject $document -Path 'changes' | ForEach-Object { $_ })
    foreach ($change in $changes) {
        $type = [string](Get-JsonValue -InputObject $change -Path 'changeType')
        switch ($type.ToLowerInvariant()) {
            'create' { $summary.Create++ }
            'modify' { $summary.Modify++ }
            'delete' { $summary.Delete++ }
            'nochange' { $summary.NoChange++ }
            default { $summary.Other++ }
        }
    }
    return $summary
}

function New-ValidationSecret {
    <# Throw-away values for a dry run when secrets.json does not exist yet. Never stored, never printed. #>
    [CmdletBinding()]
    param()
    $token = New-RandomHex -ByteCount 32
    $map = [ordered]@{}
    $map[(Get-Sha256Hex -Text $token)] = [ordered]@{ actor = 'demo-bff'; role = 'employer'; employer_id = 'emp-demo' }
    $vapid = New-VapidKeyPair
    $secrets = [pscustomobject]@{
        pgAdminPassword   = (New-RandomHex -ByteCount 32)
        demoEmployerToken = $token
        accessTokens      = (ConvertTo-Json -InputObject $map -Compress -Depth 5)
        vapidPublicKey    = $vapid.Public
        vapidPrivateKey   = $vapid.Private
        vapidSubject      = 'mailto:validate@invalid.example'
    }
    Register-SecretValue -Value @($secrets.pgAdminPassword, $secrets.demoEmployerToken, $secrets.vapidPrivateKey)
    return $secrets
}

function Invoke-ValidatePhase {
    <# One phase: `az deployment group validate`, then `what-if`. Both are read-only. Returns the number of FAILs. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][System.Collections.IDictionary]$ParamValue
    )
    $paramFile = Join-Path -Path $Config.RepoRoot -ChildPath 'infra\bicep\main.bicepparam'
    if (-not (Test-Path -LiteralPath $paramFile)) { throw "Missing $paramFile. Run this from a checkout of the feat/i1-azure-infra branch." }
    $fails = 0
    Set-ProcessEnvironment -Value $ParamValue
    try {
        try {
            Invoke-Native -FilePath 'az' -Arguments @('deployment', 'group', 'validate', '--resource-group', $Config.ResourceGroup, '--parameters', $paramFile, '--only-show-errors', '-o', 'none') | Out-Null
            Write-Say "PASS $Label template validation by ARM (az deployment group validate)"
        }
        catch {
            $fails++
            Write-Say "FAIL $Label template validation by ARM (az deployment group validate)"
            foreach ($line in @(($_.Exception.Message -split "`r?`n") | Select-Object -First 8)) { Write-Say "     $line" }
        }
        try {
            # ResourceIdOnly: ids and change types, no property values (so no secret value comes back).
            $json = Invoke-Native -FilePath 'az' -Arguments @('deployment', 'group', 'what-if', '--resource-group', $Config.ResourceGroup, '--parameters', $paramFile, '--result-format', 'ResourceIdOnly', '--no-pretty-print', '--only-show-errors', '-o', 'json')
            $counts = Get-WhatIfSummary -Json $json
            $other = ''
            if ($counts.Other -gt 0) { $other = ", $($counts.Other) other" }
            Write-Say ("PASS $Label what-if: {0} create, {1} modify, {2} delete, {3} no change{4}" -f $counts.Create, $counts.Modify, $counts.Delete, $counts.NoChange, $other)
        }
        catch {
            $fails++
            Write-Say "FAIL $Label what-if (az deployment group what-if)"
            foreach ($line in @(($_.Exception.Message -split "`r?`n") | Select-Object -First 8)) { Write-Say "     $line" }
        }
    }
    finally {
        Clear-ProcessEnvironment -Name $script:ParamEnvNames
    }
    return $fails
}

function Invoke-Validate {
    <#
    .SYNOPSIS
        Read-only dry run of both deployment phases against the resource group from state. Returns the number of FAILs.
    .DESCRIPTION
        Runs `az deployment group validate` and `what-if` for phase 1 (DEPLOY_APPS=false) and phase 2 (DEPLOY_APPS=true) with
        the same environment Deploy builds. Creates and changes nothing and costs nothing; `deployment group create` is never
        called. The images need not exist. A secret that does not exist yet (no secrets.json) is replaced by a random
        throw-away value that is neither stored nor printed.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $state = Read-StateFile
    foreach ($required in 'acrName', 'acrLoginServer', 'appsIdentityId') {
        if (-not (Get-StateValue -State $state -Key $required)) {
            throw "state.json has no '$required': run $(Get-EntryScriptCommand -Arguments '-Action Bootstrap -ContactEmail <your email>') first."
        }
    }
    $account = Invoke-DoctorLite -NeedDocker $false
    if (Test-Path -LiteralPath (Get-SecretsFilePath)) {
        $secrets = Read-SecretFile
        $secretNote = 'secrets.json'
    }
    else {
        $secrets = New-ValidationSecret
        $secretNote = 'random throw-away values (no secrets.json yet)'
    }
    $pgVersion = $Config.PostgresVersion
    if (-not $pgVersion) { $pgVersion = Get-StateValue -State $state -Key 'postgresVersion' }
    if (-not $pgVersion) { $pgVersion = '17' }
    $registry = Get-StateValue -State $state -Key 'acrLoginServer'
    $tag = 'validate'
    $apiImage = "$registry/sb-api:$tag"
    $webImage = "$registry/sb-web:$tag"
    Write-Say "Validate: subscription $(Get-JsonValue -InputObject $account -Path 'name'), resource group $($Config.ResourceGroup), PostgreSQL $pgVersion."
    if ($Config.Placeholder) { Write-Say '  images : the public quickstart placeholders' } else { Write-Say "  images : $apiImage and $webImage (they need not exist)" }
    Write-Say "  secrets: $secretNote"
    Write-Say 'This is READ-ONLY: validate and what-if create and change nothing in Azure and cost nothing.'
    Write-Say ''
    $baseArgs = @{ Config = $Config; Secrets = $secrets; State = $state; Tag = $tag; PostgresVersion = $pgVersion; ApiImage = $apiImage; WebImage = $webImage }
    $fails = 0
    $fails += Invoke-ValidatePhase -Config $Config -Label 'phase 1 (DEPLOY_APPS=false)' -ParamValue (Get-MainParamValue @baseArgs -DeployApps $false)
    $fails += Invoke-ValidatePhase -Config $Config -Label 'phase 2 (DEPLOY_APPS=true)' -ParamValue (Get-MainParamValue @baseArgs -DeployApps $true)
    Write-Say ''
    Write-Say 'Phase 2 may list the job and PostgreSQL as no change or as create: that is what a deployment on top of phase 1 would do.'
    if ($fails -eq 0) {
        Write-Say 'Validate: all checks passed.'
        if ($Config.Placeholder) { Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Deploy -Placeholder') -Why 'rehearse the Azure plumbing (creates billable resources)' }
        else { Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Deploy') -Why 'the real deploy (creates billable resources)' }
    }
    else {
        Write-Say "Validate: $fails check(s) FAILED. Nothing was created. Fix the cause above (the first lines of the error are shown), then run Validate again."
    }
    return $fails
}

function Show-Teardown {
    <# Prints the delete command. Never runs it, never calls az. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $rg = $Config.ResourceGroup
    Write-Say 'Teardown is never run for you. To delete the demo, run this yourself:'
    Write-Say ''
    Write-Say "  az group delete --name $rg --yes --no-wait"
    Write-Say ''
    Write-Say "This deletes EVERYTHING in the group ${rg}: the apps, the job, the database (and its data), the registry with its images, the identities and the logs. It cannot be undone."
    Write-Say 'It does NOT delete the subscription budget or the bootstrap deployment record (they are not in the group), nor your local secrets.json and state.json.'
    Write-Say 'The command returns at once (--no-wait). To confirm it ran, check that the group is gone (about 10 minutes):'
    Write-Say "  az group exists --name $rg      # prints false when the deletion has finished"
    Write-Say "  az group show --name $rg --query properties.provisioningState -o tsv      # prints Deleting meanwhile"
    Write-Say 'After a Teardown, run Bootstrap again before the next Deploy (it recreates the group, registry and identities).'
}
