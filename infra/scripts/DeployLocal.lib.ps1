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

# Every variable infra/bicep/main.bicepparam reads (the contract with the Bicep). Cleared after each deployment.
$script:ParamEnvNames = @(
    'ACR_NAME', 'APPS_IDENTITY_ID', 'POSTGRES_VERSION', 'PG_ADMIN_PASSWORD', 'GIT_SHA', 'DEPLOY_APPS',
    'API_IMAGE', 'API_TARGET_PORT', 'API_LIVE_PATH', 'API_READY_PATH', 'API_IS_PLACEHOLDER',
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
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Update)
    $path = Get-StateFilePath
    Assert-OutsideRepository -Path $path
    $state = Read-StateFile
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
        [string]$ReplayNow = '',
        [bool]$ReplayNowExplicit = $false,
        [switch]$Placeholder,
        [switch]$SkipBuild,
        [switch]$AllowDirty,
        [switch]$Force,
        [switch]$Yes,
        [switch]$IUnderstand,
        [string]$RepoRoot = ''
    )
    if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }
    if ($ReplayNow) {
        if ($ReplayNow -notmatch '(Z|[+-]\d{2}:\d{2})$') {
            throw "-ReplayNow must be ISO 8601 with an offset, for example $script:DefaultReplayNow. Got '$ReplayNow'."
        }
        $parsed = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse($ReplayNow, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
            throw "-ReplayNow '$ReplayNow' is not a valid ISO 8601 date and time."
        }
    }
    else { $ReplayNow = $script:DefaultReplayNow }
    return @{
        Location          = $Location
        ResourceGroup     = $ResourceGroup
        ContactEmail      = $ContactEmail
        VapidSubject      = $VapidSubject
        PostgresVersion   = $PostgresVersion
        GitHubOwner       = $GitHubOwner
        ReplayNow         = $ReplayNow
        ReplayNowExplicit = $ReplayNowExplicit
        Placeholder       = [bool]$Placeholder
        SkipBuild         = [bool]$SkipBuild
        AllowDirty        = [bool]$AllowDirty
        Force             = [bool]$Force
        Yes               = [bool]$Yes
        IUnderstand       = [bool]$IUnderstand
        RepoRoot          = $RepoRoot
    }
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
                try { $assignee = Invoke-Native -FilePath 'az' -Arguments @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv') } catch { $assignee = '' }
                if (-not $assignee) { $assignee = [string](Get-JsonValue -InputObject $account -Path 'user.name') }
                $owner = Invoke-Native -FilePath 'az' -Arguments @('role', 'assignment', 'list', '--assignee', $assignee, '--scope', "/subscriptions/$subscriptionId", '--include-inherited', '--query', "[?roleDefinitionName=='Owner'].roleDefinitionName", '-o', 'tsv')
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
    if ($fails -eq 0) {
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action InitSecrets -VapidSubject mailto:<your real address>') -Why 'create the secrets (once)'
    }
    else {
        Write-Say 'Fix every FAIL above, then run Doctor again.'
    }
    return $fails
}

function Invoke-DoctorLite {
    <# The checks Deploy and Bootstrap cannot work without. Returns the account object; throws one message listing every problem. #>
    [CmdletBinding()]
    param([bool]$NeedDocker = $true)
    $problems = New-Object System.Collections.Generic.List[string]
    $account = $null
    if (-not (Test-CommandAvailable -Name 'az')) { $problems.Add('az is not on PATH (winget install --exact --id Microsoft.AzureCLI, then a NEW terminal)') }
    else {
        try { $account = (Invoke-Native -FilePath 'az' -Arguments @('account', 'show', '-o', 'json')) | ConvertFrom-Json }
        catch { $problems.Add('not signed in to az (run: az login)') }
        try { Invoke-Native -FilePath 'az' -Arguments @('extension', 'show', '--name', 'containerapp', '--query', 'version', '-o', 'tsv') | Out-Null }
        catch { $problems.Add('az extension containerapp is missing (run: az extension add --name containerapp --upgrade)') }
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

function Invoke-Bootstrap {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    if ([string]::IsNullOrWhiteSpace($Config.ContactEmail)) {
        throw '-ContactEmail is required: the address that receives the monthly budget alerts.'
    }
    $account = Invoke-DoctorLite -NeedDocker $false
    $state = Read-StateFile
    $month = Get-StateValue -State $state -Key 'budgetMonth'
    if (-not $month) { $month = (Get-Date).ToUniversalTime().ToString('yyyy-MM', [System.Globalization.CultureInfo]::InvariantCulture) }
    $paramFile = Join-Path -Path $Config.RepoRoot -ChildPath 'infra\bicep\bootstrap.bicepparam'
    if (-not (Test-Path -LiteralPath $paramFile)) { throw "Missing $paramFile. Run this from a checkout of the feat/i1-azure-infra branch." }

    Write-Say "Bootstrap (one time, as Owner): subscription $(Get-JsonValue -InputObject $account -Path 'name'), region $($Config.Location)."
    Write-Say "It creates the resource group $($Config.ResourceGroup), a USD 75 monthly budget alerting $($Config.ContactEmail), two identities, the registry (Basic) and the role assignments."
    Write-Say "Budget month: $month (a re-run in a later month reuses it from state.json)."
    if ($Config.GitHubOwner) { Write-Say "GitHub owner: $($Config.GitHubOwner) (a federated credential for repo:$($Config.GitHubOwner)/stellar-blaze:environment:demo is created)." }
    else { Write-Say 'No -GitHubOwner: no federated credential is created (add it later by re-running with -GitHubOwner).' }

    $operator = Invoke-Native -FilePath 'az' -Arguments @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv')
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
        budgetMonth       = $month
        location          = $Config.Location
    }
    foreach ($required in 'acrName', 'acrLoginServer', 'appsIdentityId', 'resourceGroupName') {
        if (-not $update[$required]) { throw "The bootstrap deployment has no output '$required'. Inspect: az deployment sub show --name sb-bootstrap" }
    }
    Save-StateFile -Update $update
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
    $values = [ordered]@{
        ACR_NAME            = Get-StateValue -State $State -Key 'acrName'
        APPS_IDENTITY_ID    = Get-StateValue -State $State -Key 'appsIdentityId'
        POSTGRES_VERSION    = $PostgresVersion
        PG_ADMIN_PASSWORD   = $Secrets.pgAdminPassword
        GIT_SHA             = $Tag
        DEPLOY_APPS         = $DeployApps.ToString().ToLowerInvariant()
        JOBS_IMAGE          = $script:JobsPlaceholderImage
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
    $started = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'start', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '--query', 'name', '-o', 'tsv', '--only-show-errors')
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
        $jobImage = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'job', 'show', '--name', $script:MigrateJobName, '--resource-group', $ResourceGroup, '--query', 'properties.template.containers[0].image', '-o', 'tsv', '--only-show-errors')
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
        therefore requires the latest revision to be the latest READY revision AND to run the image just built.
        Ingress apps need healthState Healthy and 100 % traffic; the worker (no ingress, no probes) accepts Healthy or None.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Snapshot,
        [Parameter(Mandatory)][string]$ExpectedImage,
        [Parameter(Mandatory)][ValidateSet('Ingress', 'Worker')][string]$Kind
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
    $running = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'runningState')
    if ($running -ne 'Running') { $failures.Add("revision runningState is '$running', expected Running") }
    $health = [string](Get-RevisionValue -Revision $Snapshot.Revision -Path 'healthState')
    if ($Kind -eq 'Worker') {
        if ($health -ne 'Healthy' -and $health -ne 'None') { $failures.Add("revision healthState is '$health', expected Healthy or None") }
    }
    else {
        if ($health -ne 'Healthy') { $failures.Add("revision healthState is '$health', expected Healthy") }
        $traffic = Get-RevisionValue -Revision $Snapshot.Revision -Path 'trafficWeight'
        if ($null -eq $traffic -or [int]$traffic -ne 100) { $failures.Add("revision trafficWeight is '$traffic', expected 100") }
    }
    $replicas = Get-RevisionValue -Revision $Snapshot.Revision -Path 'replicas'
    if ($null -eq $replicas -or [int]$replicas -lt 1) { $failures.Add("revision has '$replicas' replicas, expected at least 1") }
    return $failures.ToArray()
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
                $failures = @(Get-GateFailure -Snapshot $snapshot -ExpectedImage $item.Image -Kind $item.Kind)
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
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Url)
    $text = ''
    try {
        $text = Invoke-Native -FilePath 'curl.exe' -Arguments @('--silent', '--max-time', '15', '--output', 'NUL', '--write-out', '%{http_code}', $Url) -Label 'curl.exe'
    }
    catch { return 0 }
    $code = 0
    if ([int]::TryParse($text, [ref]$code)) { return $code }
    return 0
}

function Wait-HttpOk {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Url, [int]$TimeoutSeconds = 120, [int]$IntervalSeconds = 10)
    $waited = 0
    $status = 0
    while ($true) {
        $status = Get-HttpStatus -Url $Url
        if ($status -eq 200) { return }
        if ($waited -ge $TimeoutSeconds) { throw "GET $Url answered $status after $TimeoutSeconds s, expected 200." }
        Write-Say "  GET $Url answered $status; waiting"
        Start-DeployDelay -Seconds $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Invoke-DemoSmoke {
    [CmdletBinding()]
    <# -Fresh: a just-deployed web app (wait for /api/healthz first, and sleep 62 s at the end so the rate limit H6 drained is clear). #>
    param([Parameter(Mandatory)][string]$BaseUrl, [switch]$Fresh)
    $script = Join-Path -Path $script:LibDir -ChildPath 'Test-DemoHttp.ps1'
    $global:LASTEXITCODE = 0
    if ($Fresh) { & $script -BaseUrl $BaseUrl -WaitReady -Wait | Out-Host } else { & $script -BaseUrl $BaseUrl | Out-Host }
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
        $webFqdn = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', 'web', '--resource-group', $ResourceGroup, '--query', 'properties.configuration.ingress.fqdn', '-o', 'tsv', '--only-show-errors')
    }
    if (-not $webFqdn) { throw 'The web app has no ingress FQDN.' }
    return [pscustomobject]@{ WebFqdn = $webFqdn; ApiFqdn = $apiFqdn }
}

function Invoke-Deploy {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $total = 12
    $state = Read-StateFile
    foreach ($required in 'acrName', 'acrLoginServer', 'appsIdentityId') {
        if (-not (Get-StateValue -State $state -Key $required)) {
            throw "state.json has no '$required': run $(Get-EntryScriptCommand -Arguments '-Action Bootstrap -ContactEmail <your email>') first."
        }
    }
    $secrets = Read-SecretFile
    $registry = Get-StateValue -State $state -Key 'acrLoginServer'
    $placeholder = [bool]$Config.Placeholder

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
    if ($placeholder -and (Get-StateValue -State $state -Key 'lastTag') -and (Get-StateValue -State $state -Key 'placeholder') -eq 'False') {
        Write-Say '  WARNING      : a real deployment exists; -Placeholder REPLACES its apps with the public quickstart images (the database is kept).'
    }
    if (-not (Confirm-Action -Prompt 'This creates billable Azure resources (see the cost note in infra/README.md).' -Yes $Config.Yes)) {
        throw 'Cancelled by the operator. Nothing was created.'
    }

    if (-not $placeholder) {
        Write-Say "[3/$total] registry login"
        Invoke-Native -FilePath 'az' -Arguments @('acr', 'login', '--name', (Get-StateValue -State $state -Key 'acrName'), '--only-show-errors') | Out-Null
        if ($Config.SkipBuild) {
            Write-Say "[4/$total] -SkipBuild: checking that both images exist in the registry for tag $tag"
            foreach ($repo in @("sb-api:$tag", "sb-web:$tag")) {
                try { Invoke-Native -FilePath 'az' -Arguments @('acr', 'repository', 'show', '--name', (Get-StateValue -State $state -Key 'acrName'), '--image', $repo, '--query', 'name', '-o', 'tsv', '--only-show-errors') | Out-Null }
                catch { throw "Image $repo is not in the registry. Run Deploy without -SkipBuild." }
            }
            Write-Say "[5/$total] root-store check skipped: the image was not built here (it was checked when it was built)"
            Write-Say "[6/$total] nothing to push"
        }
        else {
            Write-Say "[4/$total] building"
            Invoke-ImageBuild -Config $Config -Registry $registry -Tag $tag | Out-Null
            Write-Say "[5/$total] root-store check of the api image (ADR 0042)"
            Test-ApiImageRootStore -Image $apiImage
            Write-Say '  PASS the image trusts both Azure PostgreSQL roots'
            Write-Say "[6/$total] pushing"
            Push-DeployImage -Image @($apiImage, $webImage)
        }
    }
    else {
        Write-Say "[3/$total] [4/$total] [5/$total] [6/$total] placeholder: no login, build, root-store check or push"
    }

    $baseArgs = @{ Config = $Config; Secrets = $secrets; State = $state; Tag = $tag; PostgresVersion = $pgVersion; ApiImage = $apiImage; WebImage = $webImage }
    Write-Say "[7/$total] phase 1: environment, Postgres and the migration job (Postgres creation takes 5 to 15 minutes; nothing prints until it ends)"
    Invoke-MainDeployment -Config $Config -Name "sb-main-p1-$tag" -ParamValue (Get-MainParamValue @baseArgs -DeployApps $false)
    Save-StateFile -Update @{ postgresVersionDeployed = $pgVersion }

    if ($placeholder) {
        Write-Say "[8/$total] placeholder: no migration"
    }
    else {
        Write-Say "[8/$total] migration (job-migrate runs the image just built)"
        Invoke-Migration -ResourceGroup $Config.ResourceGroup -ExpectedImage $apiImage | Out-Null
    }

    Write-Say "[9/$total] phase 2: the apps"
    Invoke-MainDeployment -Config $Config -Name "sb-main-p2-$tag" -ParamValue (Get-MainParamValue @baseArgs -DeployApps $true)

    Write-Say "[10/$total] revision gates (up to 300 s)"
    if ($placeholder) {
        $targets = @(
            @{ App = 'api'; Kind = 'Ingress'; Image = $script:PlaceholderImage },
            @{ App = 'web'; Kind = 'Ingress'; Image = $script:PlaceholderImage }
        )
    }
    else {
        $targets = @(
            @{ App = 'api'; Kind = 'Ingress'; Image = $apiImage },
            @{ App = 'web'; Kind = 'Ingress'; Image = $webImage },
            @{ App = 'alerts'; Kind = 'Worker'; Image = $apiImage }
        )
    }
    Wait-AppGate -ResourceGroup $Config.ResourceGroup -Target $targets
    $outputs = Get-DeployOutput -ResourceGroup $Config.ResourceGroup -DeploymentName "sb-main-p2-$tag"
    $webUrl = "https://$($outputs.WebFqdn)"

    Write-Say "[11/$total] HTTP check"
    if ($placeholder) {
        Wait-HttpOk -Url "$webUrl/"
        Write-Say "  PASS GET $webUrl/ answered 200 (the demo smoke test is skipped for placeholders)"
    }
    else {
        if (-not (Invoke-DemoSmoke -BaseUrl $webUrl -Fresh)) {
            throw "The demo HTTP checks failed (see the FAIL lines above). Re-run them with: $(Get-EntryScriptCommand -Arguments '-Action Smoke')"
        }
    }

    Save-StateFile -Update @{
        lastTag      = $tag
        placeholder  = $placeholder
        webFqdn      = $outputs.WebFqdn
        apiFqdn      = $outputs.ApiFqdn
        apiImage     = $(if ($placeholder) { $script:PlaceholderImage } else { $apiImage })
        webImage     = $(if ($placeholder) { $script:PlaceholderImage } else { $webImage })
    }
    Write-Say "[12/$total] done"
    Write-Say ''
    Write-Say "Web (public) : $webUrl"
    if ($outputs.ApiFqdn) { Write-Say "Api (INTERNAL, not reachable from the internet; web calls it): https://$($outputs.ApiFqdn)" }
    if (-not $placeholder) {
        Write-Say ''
        Write-Say 'Replay clock: in replay mode api and alerts each start their clock at the anchor (10:10 Asia/Dubai) when they start, and it then runs at real speed, so a demo left running walks through the whole replay day in about 8 hours. Run ResetClock before EVERY judged session (it restarts both together).'
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action ResetClock') -Why 'before every judged session'
        Write-Say ('  then: ' + (Get-EntryScriptCommand -Arguments '-Action Status') + '   to look again, or   ' + (Get-EntryScriptCommand -Arguments '-Action Teardown') + '   to see how to delete everything.')
    }
    else {
        Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Deploy') -Why 'the plumbing works; now deploy the real images (the apps are replaced; wait 10 minutes after Bootstrap first)'
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# Replay clock, status, smoke, teardown
# ---------------------------------------------------------------------------------------------------------------------

function Get-ReplayClockEstimate {
    <# anchor + (now - start): what a replay-mode process that started at StartUtc believes the time is. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Anchor, [Parameter(Mandatory)][datetime]$StartUtc, [Parameter(Mandatory)][datetime]$NowUtc)
    $anchorTime = [DateTimeOffset]::Parse($Anchor, [System.Globalization.CultureInfo]::InvariantCulture)
    $elapsed = $NowUtc.ToUniversalTime() - $StartUtc.ToUniversalTime()
    return $anchorTime.Add($elapsed)
}

function Get-AppEnvValue {
    [CmdletBinding()]
    param($Snapshot, [Parameter(Mandatory)][string]$Name)
    $entries = @(Get-RevisionValue -Revision $Snapshot.Revision -Path 'template.containers[0].env')
    foreach ($entry in $entries) {
        if ($null -ne $entry -and "$($entry.name)" -eq $Name -and $null -ne $entry.PSObject.Properties['value']) { return [string]$entry.value }
    }
    return ''
}

function Invoke-ResetClock {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $state = Read-StateFile
    if ((Get-StateValue -State $state -Key 'placeholder') -eq 'True') {
        Write-Say 'The last deploy was a placeholder: there is no replay clock (no api or alerts yet). Nothing to reset.'
        return
    }
    Invoke-DoctorLite -NeedDocker $false | Out-Null
    $rg = $Config.ResourceGroup
    $apps = @('api', 'alerts')
    $snapshots = @{}
    foreach ($app in $apps) { $snapshots[$app] = Get-AppSnapshot -App $app -ResourceGroup $rg }
    $targets = @()
    foreach ($app in $apps) {
        $image = [string](Get-JsonValue -InputObject $snapshots[$app].App -Path 'properties.template.containers[0].image')
        $targets += @{ App = $app; Kind = $(if ($app -eq 'api') { 'Ingress' } else { 'Worker' }); Image = $image }
    }
    $currentAnchor = Get-AppEnvValue -Snapshot $snapshots['api'] -Name 'SB_REPLAY_NOW'
    $stamps = @{}
    if ($Config.ReplayNowExplicit) {
        Write-Say "Setting SB_REPLAY_NOW=$($Config.ReplayNow) on api and alerts (each change creates a new revision, so each restarts)."
        foreach ($app in $apps) {
            Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'update', '--name', $app, '--resource-group', $rg, '--set-env-vars', "SB_REPLAY_NOW=$($Config.ReplayNow)", '--only-show-errors', '-o', 'none') | Out-Null
            $stamps[$app] = (Get-Date).ToUniversalTime()
        }
        $anchor = $Config.ReplayNow
    }
    else {
        Write-Say 'Restarting the active revision of api and alerts back to back...'
        foreach ($app in $apps) {
            $revision = [string](Get-JsonValue -InputObject $snapshots[$app].App -Path 'properties.latestRevisionName')
            Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'revision', 'restart', '--name', $app, '--resource-group', $rg, '--revision', $revision, '--only-show-errors', '-o', 'none') | Out-Null
            $stamps[$app] = (Get-Date).ToUniversalTime()
        }
        $anchor = $currentAnchor
        if (-not $anchor) { $anchor = $Config.ReplayNow }
    }
    Start-DeployDelay -Seconds 15
    Write-Say 'Waiting for both to be healthy again (up to 300 s)...'
    Wait-AppGate -ResourceGroup $rg -Target $targets
    Write-Say ''
    Write-Say "Replay clock anchor : $anchor"
    foreach ($app in $apps) { Write-Say "  $app restarted at $($stamps[$app].ToString('HH:mm:ss')) UTC" }
    Write-Say 'Both clocks now start from the anchor within seconds of each other and run at real speed (about 8 hours cover the whole replay day).'
    Write-Say 'Restarting only ONE of the two desynchronises their clocks (api and alerts would disagree by hours): always restart both, as this action does.'
    Write-Say 'The next Bicep deploy (Deploy) resets SB_REPLAY_NOW to the template value (10:10), whatever -ReplayNow set here.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Status') -Why 'confirm both clocks'
}

function Invoke-Status {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    Invoke-DoctorLite -NeedDocker $false | Out-Null
    $state = Read-StateFile
    $rg = $Config.ResourceGroup
    Write-Say "Resource group: $rg ($($Config.Location))    last tag: $(Get-StateValue -State $state -Key 'lastTag')"
    $webFqdn = Get-StateValue -State $state -Key 'webFqdn'
    $apiFqdn = Get-StateValue -State $state -Key 'apiFqdn'
    if ($webFqdn) { Write-Say "Web (public) : https://$webFqdn" }
    if ($apiFqdn) { Write-Say "Api (internal): https://$apiFqdn" }
    $expected = @{ api = (Get-StateValue -State $state -Key 'apiImage'); web = (Get-StateValue -State $state -Key 'webImage'); alerts = (Get-StateValue -State $state -Key 'apiImage') }
    $kinds = @{ api = 'Ingress'; web = 'Ingress'; alerts = 'Worker' }
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
        $failures = @(Get-GateFailure -Snapshot $snapshot -ExpectedImage $want -Kind $kinds[$app])
        $replicas = Get-RevisionValue -Revision $snapshot.Revision -Path 'replicas'
        $verdict = 'OK'
        if ($failures.Count -gt 0) { $verdict = 'NOT OK' }
        Write-Say "$app : $verdict  revision=$(Get-JsonValue -InputObject $snapshot.App -Path 'properties.latestRevisionName')  replicas=$replicas"
        Write-Say "       image=$image"
        foreach ($failure in $failures) { Write-Say "       - $failure" }
    }
    # The replay clock: what each process believes the time is, from when its replica started (field names unverified).
    if ($snapshots.ContainsKey('api') -and $snapshots.ContainsKey('alerts')) {
        $anchor = Get-AppEnvValue -Snapshot $snapshots['api'] -Name 'SB_REPLAY_NOW'
        if (-not $anchor) { $anchor = $Config.ReplayNow }
        $now = (Get-Date).ToUniversalTime()
        $estimates = @{}
        foreach ($app in 'api', 'alerts') {
            try {
                $revision = [string](Get-JsonValue -InputObject $snapshots[$app].App -Path 'properties.latestRevisionName')
                $replicaJson = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'replica', 'list', '--name', $app, '--resource-group', $rg, '--revision', $revision, '-o', 'json', '--only-show-errors')
                $replicas = @(ConvertFrom-JsonArray -Text $replicaJson)
                $start = $null
                if ($replicas.Count -gt 0) { $start = ConvertTo-UtcDateTime -Value (Get-JsonValue -InputObject $replicas[0] -Path 'properties.createdTime') }
                if ($null -eq $start) { $start = ConvertTo-UtcDateTime -Value (Get-RevisionValue -Revision $snapshots[$app].Revision -Path 'createdTime') }
                if ($null -ne $start) { $estimates[$app] = Get-ReplayClockEstimate -Anchor $anchor -StartUtc $start -NowUtc $now }
            }
            catch { Write-Say "replay clock of $app : could not be read ($(($_.Exception.Message -split "`n")[0]))" }
        }
        foreach ($app in $estimates.Keys) {
            $local = $estimates[$app].ToOffset([TimeSpan]::FromHours(4))
            $inside = ($local.TimeOfDay -ge [TimeSpan]::FromHours(10)) -and ($local.TimeOfDay -le [TimeSpan]::FromMinutes(17 * 60 + 30))
            $note = 'inside the 10:00-17:30 demo window'
            if (-not $inside) { $note = 'OUTSIDE the 10:00-17:30 window: run ResetClock' }
            Write-Say "replay clock $app : about $($local.ToString('HH:mm:ss')) Asia/Dubai ($note)"
        }
        if ($estimates.ContainsKey('api') -and $estimates.ContainsKey('alerts')) {
            $delta = [math]::Abs(($estimates['api'] - $estimates['alerts']).TotalSeconds)
            if ($delta -gt 120) { Write-Say "WARN api and alerts clocks differ by $([math]::Round($delta)) s: run ResetClock (it restarts both)." }
            else { Write-Say "api and alerts clocks agree within $([math]::Round($delta)) s." }
        }
    }
    Write-Say ''
    Write-Say 'Cost reminder: three always-on apps plus Postgres B1ms bill by the hour for as long as they exist (the plan estimates roughly USD 60 to 75 a month; the alerts worker may push it above the USD 75 budget alert). Delete everything when the demo is over.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action Teardown') -Why 'when you are done, to see the delete command'
}

function Invoke-Smoke {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Config)
    $state = Read-StateFile
    $fqdn = Get-StateValue -State $state -Key 'webFqdn'
    if (-not $fqdn) {
        Invoke-DoctorLite -NeedDocker $false | Out-Null
        $fqdn = Invoke-Native -FilePath 'az' -Arguments @('containerapp', 'show', '--name', 'web', '--resource-group', $Config.ResourceGroup, '--query', 'properties.configuration.ingress.fqdn', '-o', 'tsv', '--only-show-errors')
    }
    if (-not $fqdn) { throw 'No web FQDN known. Deploy first.' }
    $url = "https://$fqdn"
    if ((Get-StateValue -State $state -Key 'placeholder') -eq 'True') {
        Write-Say 'The last deploy was a placeholder: only GET / is checked.'
        Wait-HttpOk -Url "$url/" -TimeoutSeconds 30
        Write-Say "PASS GET $url/ answered 200"
        return
    }
    if (-not (Invoke-DemoSmoke -BaseUrl $url)) { throw 'Demo HTTP checks failed (see the FAIL lines above).' }
    Write-Say 'All demo HTTP checks passed. Note: the last check uses up the rate limit of the demo token for about a minute.'
    Write-Next -Command (Get-EntryScriptCommand -Arguments '-Action ResetClock') -Why 'before every judged session'
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
