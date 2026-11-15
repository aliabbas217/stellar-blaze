#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Test helpers that build fixtures in temp folders; they are not cmdlets.')]
param()
# Pester 5 tests of infra/scripts/DeployLocal.lib.ps1 and infra/scripts/Test-DemoHttp.ps1.
# No network, no Azure. `Invoke-Native` (the one place az, docker, git and curl.exe are called) is mocked, except where a
# test says it uses a real program: cmd.exe, icacls, a local HTTP mock server, and (tag Docker) the local image
# stellar-blaze-api:i1.
#
# Run: infra/scripts/tests/ps/run-ps-tests.ps1

BeforeDiscovery {
    $script:DockerImageAvailable = $false
    try {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $null = & docker image inspect stellar-blaze-api:i1 2>&1
        $script:DockerImageAvailable = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $previous
    }
    catch { $script:DockerImageAvailable = $false }
}

BeforeAll {
    Set-StrictMode -Version 2.0
    $script:ScriptsDir = (Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..\..')).Path
    $script:RepoDir = (Resolve-Path -LiteralPath (Join-Path -Path $script:ScriptsDir -ChildPath '..\..')).Path
    . (Join-Path -Path $script:ScriptsDir -ChildPath 'DeployLocal.lib.ps1')

    $script:Registry = 'acrsbtest123.azurecr.io'
    $script:ApiImage = "$script:Registry/sb-api:relcheck-1"
    $script:WebImage = "$script:Registry/sb-web:relcheck-1"
    $script:Placeholder = 'mcr.microsoft.com/k8se/quickstart:latest'

    # ---- fixtures -------------------------------------------------------------------------------------------------

    function New-Snapshot {
        param(
            [string]$Latest = 'api--r2', [string]$Ready = 'api--r2', [string]$Provisioning = 'Succeeded',
            [string]$Image = 'acrsbtest123.azurecr.io/sb-api:relcheck-1', [string]$RevProvisioning = 'Provisioned',
            [string]$Running = 'Running', [string]$Health = 'Healthy', [int]$Traffic = 100, [int]$Replicas = 1,
            [string]$Anchor = '2026-06-14T10:10:00+04:00'
        )
        $app = @{ properties = @{
                latestRevisionName = $Latest; latestReadyRevisionName = $Ready; provisioningState = $Provisioning
                template = @{ containers = @(@{ image = $Image }) }
                configuration = @{ ingress = @{ fqdn = 'x.example' } }
            }
        }
        $rev = @{ name = $Latest; properties = @{
                template = @{ containers = @(@{ image = $Image; env = @(@{ name = 'SB_REPLAY_NOW'; value = $Anchor }) }) }
                provisioningState = $RevProvisioning; runningState = $Running; healthState = $Health
                trafficWeight = $Traffic; replicas = $Replicas
            }
        }
        return [pscustomobject]@{
            Name     = 'api'
            App      = ($app | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
            Revision = ($rev | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
        }
    }

    function New-FakeRepo {
        $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-test-repo-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'infra\bicep') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'backend') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'frontend') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'infra\bicep\main.bicep') -Value '// fake: az bicep build is mocked'
        Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'infra\bicep\main.bicepparam') -Value "using 'main.bicep'"
        Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'infra\bicep\bootstrap.bicepparam') -Value "using 'bootstrap.bicep'"
        return $root
    }

    # The az containerapp show document of one app. As designed: api has an internal ingress, web an external one, alerts none.
    # -External overrides the ingress (for the tests of the exposure guard); -MaxReplicas the scale (cost guard).
    function New-AppJsonText {
        param([string]$App, [string]$Image, [Nullable[bool]]$External = $null, [int]$MaxReplicas = 1)
        $latest = "$App--r1"
        $configuration = @{}
        if ($App -ne 'alerts' -or $null -ne $External) {
            $isExternal = ($App -eq 'web')
            if ($null -ne $External) { $isExternal = [bool]$External }
            $configuration = @{ ingress = @{ fqdn = "$App.test.example"; external = $isExternal } }
        }
        $obj = @{ properties = @{
                latestRevisionName = $latest; latestReadyRevisionName = $latest; provisioningState = 'Succeeded'
                template = @{ containers = @(@{ image = $Image }); scale = @{ minReplicas = 1; maxReplicas = $MaxReplicas } }
                configuration = $configuration
            }
        }
        return ($obj | ConvertTo-Json -Depth 10)
    }

    # The compiled main.bicep (az bicep build --stdout) in the shape Bicep 0.49 really produces it (checked against a real
    # build): variables with the env arrays, one Microsoft.Resources/deployments per module, the env parameter either an
    # object with a value or one whole expression string. The switches break exactly one property.
    function New-CompiledTemplateText {
        param(
            [string]$UrlSuffix = '?ssl=verify-full',
            [string]$RootCert = '/etc/ssl/certs/ca-certificates.crt',
            [switch]$AlertsWithoutCoreEnv,
            [switch]$OmitJobModule,
            [string]$ExtraVariable = ''
        )
        $urlExpr = "format('postgresql+asyncpg://sbadmin:{0}@{1}:5432/stellar_blaze$UrlSuffix', parameters('pgAdminPassword'), reference(resourceId('Microsoft.Resources/deployments', 'postgres'), '2025-04-01').outputs.fqdn.value)"
        $secretsExpr = "[if(parameters('apiIsPlaceholder'), createObject('value', createArray()), createObject('value', createArray(createObject('name', 'sb-database-url', 'value', $urlExpr))))]"
        $alertsEnv = "[concat(variables('coreEnv'), variables('runtimeEnv'))]"
        if ($AlertsWithoutCoreEnv) { $alertsEnv = "[variables('runtimeEnv')]" }
        $variables = [ordered]@{
            migrateJobName = 'job-migrate'
            pgSslRootCert  = $RootCert
            coreEnv        = @(
                @{ name = 'SB_ENV'; value = 'prod' },
                @{ name = 'SB_GIT_SHA'; value = "[parameters('gitSha')]" },
                @{ name = 'SB_DATABASE_URL'; secretRef = 'sb-database-url' },
                @{ name = 'PGSSLROOTCERT'; value = "[variables('pgSslRootCert')]" }
            )
            runtimeEnv     = "[createArray(createObject('name', 'SB_FORECAST_SOURCE', 'value', parameters('forecastSource')))]"
            apiEnv         = "[concat(variables('coreEnv'), variables('runtimeEnv'), createArray(createObject('name', 'SB_ACCESS_TOKENS', 'secretRef', 'sb-access-tokens')))]"
            alertsEnv      = $alertsEnv
        }
        if ($ExtraVariable) { $variables['note'] = $ExtraVariable }
        $module = {
            param($Name, $EnvParam)
            return @{ type = 'Microsoft.Resources/deployments'; apiVersion = '2025-04-01'; name = $Name; properties = @{ mode = 'Incremental'; parameters = @{ env = $EnvParam; secrets = $secretsExpr } } }
        }
        $resources = New-Object System.Collections.Generic.List[object]
        $resources.Add((& $module 'monitoring' @{ value = 'x' }))
        if (-not $OmitJobModule) {
            $resources.Add((& $module 'job-migrate' "[if(parameters('apiIsPlaceholder'), createObject('value', createArray()), createObject('value', variables('coreEnv')))]"))
        }
        $resources.Add((& $module 'app-api' "[if(parameters('apiIsPlaceholder'), createObject('value', createArray()), createObject('value', variables('apiEnv')))]"))
        $resources.Add((& $module 'app-web' @{ value = "[createArray(createObject('name', 'API_ORIGIN', 'value', 'x'))]" }))
        $resources.Add((& $module 'app-alerts' @{ value = $alertsEnv }))
        $template = [ordered]@{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#'; contentVersion = '1.0.0.0'; variables = $variables; resources = $resources.ToArray() }
        # Windows PowerShell 5.1 writes an apostrophe as backslash-u0027; Bicep writes it as it is.
        $apostropheEscape = '\' + 'u0027'
        return (($template | ConvertTo-Json -Depth 30).Replace($apostropheEscape, "'"))
    }

    function New-RevisionJsonText {
        param([string]$App, [string]$Image, [string]$Health = 'Healthy')
        $obj = @{ name = "$App--r1"; properties = @{
                template = @{ containers = @(@{ image = $Image; env = @(@{ name = 'SB_REPLAY_NOW'; value = '2026-06-14T10:10:00+04:00' }) }) }
                provisioningState = 'Provisioned'; runningState = 'Running'; healthState = $Health
                trafficWeight = 100; replicas = 1; createdTime = '2026-11-15T08:00:00Z'
            }
        }
        return ($obj | ConvertTo-Json -Depth 10)
    }

    # The stdout of `curl.exe --include --write-out "\n%{http_code}"` (Invoke-Native has already removed the carriage returns).
    function New-CurlResponseText {
        param([int]$Status, [string]$Body = '', [string]$RetryAfter = '')
        $headers = "HTTP/1.1 $Status Status`nContent-Type: application/json"
        if ($RetryAfter) { $headers += "`nRetry-After: $RetryAfter" }
        return ($headers + "`n`n" + $Body + "`n" + $Status)
    }

    # The answer of POST demo-reset: every call starts the next epoch (the demo site starts in epoch 1, made by the site load).
    function New-ResetAnswer {
        $previous = $script:Epoch
        $script:Epoch = $previous + 1
        $body = '{"site_id":"site-demo-mussafah","epoch_id":' + $script:Epoch + ',"previous_epoch_id":' + $previous + ',"reset_at":"2026-11-15T09:00:00Z"}'
        return (New-CurlResponseText -Status 200 -Body $body)
    }

    # The default answers of the fake az, docker, git and curl.exe for a complete REAL deploy. First match wins.
    function Get-DefaultResponse {
        return @(
            @{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-ResetAnswer) } },
            # the deployment guards (ADR 0042 and the exposure and cost checks): more specific than the patterns below
            @{ Pattern = '^az bicep build'; Value = { return $script:CompiledTemplate } },
            @{ Pattern = '^az containerapp (job )?secret list'; Value = { return $script:DatabaseUrlValue } },
            @{ Pattern = '^az containerapp (job )?show .*PGSSLROOTCERT'; Value = { return $script:RootCertValue } },
            @{ Pattern = '^az containerapp env list'; Value = 'cae-test' },
            @{ Pattern = '^az containerapp env show'; Value = '{"properties":{"workloadProfiles":[{"name":"Consumption","workloadProfileType":"Consumption"}]}}' },
            @{ Pattern = '^az resource list'; Value = { return $script:ResourceListJson } },
            @{ Pattern = '^az group exists'; Value = 'true' },
            @{ Pattern = '^az containerapp revision restart'; Value = '' },
            @{ Pattern = '^icacls '; Value = '' },
            @{ Pattern = '^az account show'; Value = '{"id":"00000000-0000-0000-0000-000000000001","name":"Test Subscription","user":{"name":"ali@example.org"}}' },
            @{ Pattern = '^az extension show'; Value = '1.2.3' },
            @{ Pattern = '^docker info'; Value = '29.0.0' },
            @{ Pattern = '^git -C .* rev-parse'; Value = 'relcheck-1' },
            @{ Pattern = '^git -C .* status'; Value = '' },
            @{ Pattern = '^az acr login'; Value = 'Login Succeeded' },
            @{ Pattern = '^docker build'; Value = '' },
            @{ Pattern = '^docker run'; Value = '' },
            @{ Pattern = '^docker push'; Value = '' },
            @{ Pattern = '^az deployment group create'; Value = {
                    param($line)
                    $script:EnvSeen.Add(@{
                            Line = $line; Apps = $env:DEPLOY_APPS; HasPassword = [bool]$env:PG_ADMIN_PASSWORD
                            HasVapid = [bool]$env:VAPID_PRIVATE_KEY; ApiPlaceholder = $env:API_IS_PLACEHOLDER; ApiImage = $env:API_IMAGE
                            WebImage = $env:WEB_IMAGE; ApiPort = $env:API_TARGET_PORT; Hops = $env:TRUSTED_PROXY_HOPS
                            Ruleset = $env:SB_RULESET_ID; Model = $env:SB_MODEL_ID; GitSha = $env:GIT_SHA
                        })
                    return ''
                }
            },
            @{ Pattern = '^az containerapp job show'; Value = { return $script:JobImage } },
            @{ Pattern = '^az containerapp job start'; Value = 'job-migrate-x1' },
            @{ Pattern = '^az containerapp job execution show'; Value = 'Succeeded' },
            @{ Pattern = '^az containerapp show --name (api|web|alerts) .* -o json'; Value = {
                    param($line)
                    $null = $line -match '--name (\w+)'
                    return (New-AppJsonText -App $Matches[1] -Image $script:ImageFor[$Matches[1]])
                }
            },
            @{ Pattern = '^az containerapp revision show --name (api|web|alerts)'; Value = {
                    param($line)
                    $null = $line -match '--name (\w+)'
                    return (New-RevisionJsonText -App $Matches[1] -Image $script:ImageFor[$Matches[1]])
                }
            },
            @{ Pattern = '^az deployment group show'; Value = '{"webFqdn":{"type":"String","value":"web.test.example"},"apiFqdn":{"type":"String","value":"api.internal.test.example"}}' },
            @{ Pattern = '^curl.exe '; Value = '200' }
        )
    }

    function Set-NativeMock {
        param([object[]]$Override = @())
        $script:Calls = New-Object System.Collections.Generic.List[string]
        $script:EnvSeen = New-Object System.Collections.Generic.List[object]
        $script:Responses = @($Override) + @(Get-DefaultResponse)
    }

    function Get-CallIndex {
        param([string]$Pattern, [int]$After = -1)
        for ($i = $After + 1; $i -lt $script:Calls.Count; $i++) { if ($script:Calls[$i] -match $Pattern) { return $i } }
        return -1
    }

    function Get-CallCount {
        param([string]$Pattern)
        return @($script:Calls | Where-Object { $_ -match $Pattern }).Count
    }

    function Get-InfoText {
        param([scriptblock]$Script)
        $stream = & $Script 6>&1
        return ((@($stream) | ForEach-Object { "$_" }) -join "`n")
    }

    $script:CompiledTemplate = New-CompiledTemplateText
    $script:RootCertValue = '/etc/ssl/certs/ca-certificates.crt'
    $script:DatabaseUrlValue = 'postgresql+asyncpg://sbadmin:' + ([guid]::NewGuid().ToString('N')) + '@psql-test.postgres.database.azure.com:5432/stellar_blaze?ssl=verify-full'
    $script:ResourceListJson = '[{"name":"cae-test","type":"Microsoft.App/managedEnvironments","location":"uaenorth"},{"name":"api","type":"Microsoft.App/containerApps","location":"uaenorth"},{"name":"id-sb-apps","type":"Microsoft.ManagedIdentity/userAssignedIdentities","location":"uaenorth"}]'
    $script:Said = New-Object System.Collections.Generic.List[string]
    $script:Epoch = 1
    $script:ImageFor = @{ api = $script:ApiImage; web = $script:WebImage; alerts = $script:ApiImage }
    $script:JobImage = $script:ApiImage
    $script:StateDir = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-test-state-' + [guid]::NewGuid().ToString('N'))
    $env:SB_I1_STATE_DIR = $script:StateDir
    $script:FakeRepo = New-FakeRepo
}

AfterAll {
    Remove-Item Env:\SB_I1_STATE_DIR -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:FakeRepo -Recurse -Force -ErrorAction SilentlyContinue
}

# ======================================================================================================================
Describe 'Invoke-Native (real cmd.exe)' {
    BeforeEach { $script:SecretValues = @() }
    AfterEach { $script:SecretValues = @() }

    It 'returns trimmed stdout' {
        Invoke-Native -FilePath 'cmd.exe' -Arguments '/c', 'echo hello' | Should -BeExactly 'hello'
    }
    It 'throws with the command name, the exit code and the stderr text, and without the arguments' {
        $message = ''
        try { Invoke-Native -FilePath 'cmd.exe' -Arguments '/c', 'echo boom 1>&2 & exit 3 & rem Hunter2Hunter2' } catch { $message = $_.Exception.Message }
        $message | Should -Match 'cmd failed \(exit code 3\)'
        $message | Should -Match 'boom'
        $message | Should -Not -Match 'Hunter2Hunter2'
    }
    It 'masks a registered secret that the program itself writes to stderr' {
        Register-SecretValue -Value 'S3cr3tValue99'
        $message = ''
        try { Invoke-Native -FilePath 'cmd.exe' -Arguments '/c', 'echo token=S3cr3tValue99 1>&2 & exit 1' } catch { $message = $_.Exception.Message }
        $message | Should -Match 'token=\*\*\*'
        $message | Should -Not -Match 'S3cr3tValue99'
    }
    It 'builds a label from sub-command words only, never from a value that could be a secret' {
        Get-NativeLabel -FilePath 'az' -Arguments 'deployment', 'group', 'create', '--name', 'x' | Should -BeExactly 'az deployment group create'
        Get-NativeLabel -FilePath 'az' -Arguments '3f9a0c5b7d1e4a6f8b2c', 'group' | Should -BeExactly 'az'
        Get-NativeLabel -FilePath 'az' -Arguments 'abcdefabcdefabcdefabcdefabcdefabcdefabcdef' | Should -BeExactly 'az'
    }
}

# ======================================================================================================================
Describe 'Get-ImageTag' {
    BeforeEach {
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) { if ($line -match $r.Pattern) { if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value } } }
            throw "unexpected native call: $line"
        }
        $script:Config = New-DeployConfig -RepoRoot $script:FakeRepo
    }

    It 'uses the 12-character commit as the tag on a clean tree' {
        $tag = Get-ImageTag -Config $script:Config
        $tag.Tag | Should -BeExactly 'relcheck-1'
        $tag.Dirty | Should -BeFalse
        Get-CallIndex -Pattern 'rev-parse --short=12 HEAD' | Should -BeGreaterThan -1
    }
    It 'refuses a dirty tree without -AllowDirty' {
        $script:Responses = @(@{ Pattern = '^git -C .* status'; Value = ' M backend/x.py' }) + $script:Responses
        { Get-ImageTag -Config $script:Config } | Should -Throw '*uncommitted*'
    }
    It 'refuses a tree that has only untracked files' {
        $script:Responses = @(@{ Pattern = '^git -C .* status'; Value = '?? new-file.txt' }) + $script:Responses
        { Get-ImageTag -Config $script:Config } | Should -Throw '*-AllowDirty*'
    }
    It 'tags a dirty tree with the commit, dirty and a timestamp when -AllowDirty is given' {
        $script:Responses = @(@{ Pattern = '^git -C .* status'; Value = ' M backend/x.py' }) + $script:Responses
        $config = New-DeployConfig -RepoRoot $script:FakeRepo -AllowDirty
        $tag = Get-ImageTag -Config $config
        $tag.Tag | Should -Match '^relcheck-1-dirty-\d{14}$'
        $tag.Dirty | Should -BeTrue
    }
}

# ======================================================================================================================
Describe 'Get-GateFailure (Review Focus 1)' {
    It 'passes the happy fixture for an app with ingress' {
        @(Get-GateFailure -Snapshot (New-Snapshot) -ExpectedImage $script:ApiImage -Kind Ingress).Count | Should -Be 0
    }
    It 'FAILS when the serving revision runs an older image (a failed rollout keeps the old revision)' {
        $failures = @(Get-GateFailure -Snapshot (New-Snapshot -Image "$script:Registry/sb-api:OLD") -ExpectedImage $script:ApiImage -Kind Ingress)
        ($failures -join "`n") | Should -Match "expected '$([regex]::Escape($script:ApiImage))'"
    }
    It 'FAILS when latestReadyRevisionName differs from latestRevisionName' {
        $failures = @(Get-GateFailure -Snapshot (New-Snapshot -Latest 'api--r2' -Ready 'api--r1') -ExpectedImage $script:ApiImage -Kind Ingress)
        ($failures -join "`n") | Should -Match 'latestReadyRevisionName'
    }
    It 'FAILS when the revision is unhealthy, not running, not provisioned, has no replica or not all traffic' {
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -Health 'Unhealthy') -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'healthState'
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -Running 'Degraded') -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'runningState'
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -RevProvisioning 'Provisioning') -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'provisioningState'
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -Replicas 0) -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'replicas'
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -Traffic 50) -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'trafficWeight'
    }
    It 'accepts healthState None for the worker but not for an app with ingress' {
        @(Get-GateFailure -Snapshot (New-Snapshot -Health 'None' -Traffic 0) -ExpectedImage $script:ApiImage -Kind Worker).Count | Should -Be 0
        $f = @(Get-GateFailure -Snapshot (New-Snapshot -Health 'None') -ExpectedImage $script:ApiImage -Kind Ingress) -join "`n"
        $f | Should -Match 'healthState'
    }
    It 'still fails the worker on an old image or an unhealthy state' {
        @(Get-GateFailure -Snapshot (New-Snapshot -Health 'None' -Image 'old:1') -ExpectedImage $script:ApiImage -Kind Worker).Count | Should -BeGreaterThan 0
        @(Get-GateFailure -Snapshot (New-Snapshot -Health 'Unhealthy') -ExpectedImage $script:ApiImage -Kind Worker).Count | Should -BeGreaterThan 0
    }
}

Describe 'Wait-AppGate' {
    BeforeEach {
        Mock Start-DeployDelay { }
        Mock Write-Say { }
    }

    It 'throws after 300 s of polling when the revision never runs the new image' {
        Mock Get-AppSnapshot { New-Snapshot -Image "$script:Registry/sb-api:OLD" }
        $message = ''
        try { Wait-AppGate -ResourceGroup 'rg' -Target @(@{ App = 'api'; Kind = 'Ingress'; Image = $script:ApiImage }) } catch { $message = $_.Exception.Message }
        $message | Should -Match 'Revision gate failed after 300 s for: api'
        Should -Invoke Start-DeployDelay -Times 30 -Exactly
    }
    It 'passes as soon as the new revision is ready' {
        $script:Polls = 0
        Mock Get-AppSnapshot {
            $script:Polls++
            if ($script:Polls -lt 3) { return (New-Snapshot -Latest 'api--r2' -Ready 'api--r1') }
            return (New-Snapshot)
        }
        { Wait-AppGate -ResourceGroup 'rg' -Target @(@{ App = 'api'; Kind = 'Ingress'; Image = $script:ApiImage }) } | Should -Not -Throw
        Should -Invoke Start-DeployDelay -Times 2 -Exactly
    }
    It 'treats an unreadable app as a failing condition, not a crash' {
        Mock Get-AppSnapshot { throw 'az containerapp show failed (exit code 3).' }
        { Wait-AppGate -ResourceGroup 'rg' -Target @(@{ App = 'api'; Kind = 'Ingress'; Image = 'x' }) -TimeoutSeconds 20 } | Should -Throw '*could not read the app*'
    }
}

# ======================================================================================================================
Describe 'Invoke-Migration' {
    BeforeEach {
        Set-NativeMock
        $script:JobImage = $script:ApiImage
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Start-DeployDelay { }
    }

    It 'is an ERROR when the job does not exist for a real image (never a silent skip)' {
        $script:Responses = @(@{ Pattern = '^az containerapp job show'; Throw = 'az containerapp job show failed (exit code 3). ResourceNotFound' }) + $script:Responses
        { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } | Should -Throw "*job-migrate*cannot be read*"
        Get-CallCount -Pattern 'job start' | Should -Be 0
    }
    It 'stops before starting when the job runs another image' {
        $script:JobImage = "$script:Registry/sb-api:OLD"
        { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } | Should -Throw '*Nothing was started*'
        Get-CallCount -Pattern 'job start' | Should -Be 0
    }
    It 'passes on a Succeeded execution and starts exactly once' {
        Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage | Should -BeExactly 'job-migrate-x1'
        Get-CallCount -Pattern 'job start' | Should -Be 1
        Should -Invoke Start-DeployDelay -Times 0 -Exactly
    }
    It 'retries ONCE after a Failed execution, waits 90 s, then fails with the log query hint' {
        $script:Responses = @(@{ Pattern = '^az containerapp job execution show'; Value = 'Failed' }) + $script:Responses
        $message = ''
        try { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } catch { $message = $_.Exception.Message }
        $message | Should -Match 'Failed twice'
        $message | Should -Match 'ContainerAppConsoleLogs \| where ContainerGroupName startswith "job-migrate"'
        Get-CallCount -Pattern 'job start' | Should -Be 2
        Should -Invoke Start-DeployDelay -Times 1 -Exactly -ParameterFilter { $Seconds -eq 90 }
    }
    It 'succeeds when the retry succeeds' {
        $script:Statuses = New-Object System.Collections.Generic.Queue[string]
        $script:Statuses.Enqueue('Failed'); $script:Statuses.Enqueue('Succeeded')
        $script:Responses = @(@{ Pattern = '^az containerapp job execution show'; Value = { return $script:Statuses.Dequeue() } }) + $script:Responses
        { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } | Should -Not -Throw
        Get-CallCount -Pattern 'job start' | Should -Be 2
    }
    It 'polls through Running and does not retry a timeout' {
        $script:Responses = @(@{ Pattern = '^az containerapp job execution show'; Value = 'Running' }) + $script:Responses
        { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } | Should -Throw '*did not finish within 600 s*'
        Get-CallCount -Pattern 'job start' | Should -Be 1
        Should -Invoke Start-DeployDelay -Times 60 -Exactly -ParameterFilter { $Seconds -eq 10 }
    }
    It 'falls back to the newest execution in the list when start prints nothing' {
        $list = '[{"name":"job-migrate-old","properties":{"startTime":"2026-11-14T08:00:00Z"}},{"name":"job-migrate-new","properties":{"startTime":"2026-11-15T09:00:00Z"}}]'
        $script:Responses = @(
            @{ Pattern = '^az containerapp job start'; Value = '' },
            @{ Pattern = '^az containerapp job execution list'; Value = $list }
        ) + $script:Responses
        Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage | Should -BeExactly 'job-migrate-new'
    }
    It 'also falls back when start prints the job name instead of an execution name' {
        $list = '[{"name":"job-migrate-abc","properties":{"startTime":"2026-11-15T09:00:00Z"}}]'
        $script:Responses = @(
            @{ Pattern = '^az containerapp job start'; Value = 'job-migrate' },
            @{ Pattern = '^az containerapp job execution list'; Value = $list }
        ) + $script:Responses
        Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage | Should -BeExactly 'job-migrate-abc'
    }
    It 'treats the None that -o tsv prints for a null as no execution name (never polls an execution called None)' {
        $list = '[{"name":"job-migrate-abc","properties":{"startTime":"2026-11-15T09:00:00Z"}}]'
        $script:Responses = @(
            @{ Pattern = '^az containerapp job start'; Value = 'None' },
            @{ Pattern = '^az containerapp job execution list'; Value = $list }
        ) + $script:Responses
        Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage | Should -BeExactly 'job-migrate-abc'
        Get-CallCount -Pattern 'execution show .*--job-execution-name None' | Should -Be 0
    }
    It 'treats a None job image as no image, not as an image called None' {
        $script:JobImage = 'None'
        { Invoke-Migration -ResourceGroup 'rg' -ExpectedImage $script:ApiImage } | Should -Throw '*reports no image*'
        Get-CallCount -Pattern 'job start' | Should -Be 0
    }
}

Describe 'ConvertFrom-AzTsv' {
    It 'maps the None that az prints for a JSON null, and an empty answer, to the empty string' {
        ConvertFrom-AzTsv -Text 'None' | Should -BeExactly ''
        ConvertFrom-AzTsv -Text 'none' | Should -BeExactly ''
        ConvertFrom-AzTsv -Text "None`r`n" | Should -BeExactly ''
        ConvertFrom-AzTsv -Text '' | Should -BeExactly ''
        ConvertFrom-AzTsv -Text $null | Should -BeExactly ''
    }
    It 'keeps every real value, including one that starts with None' {
        ConvertFrom-AzTsv -Text 'web.test.example' | Should -BeExactly 'web.test.example'
        ConvertFrom-AzTsv -Text 'Nonexistent' | Should -BeExactly 'Nonexistent'
        ConvertFrom-AzTsv -Text 'a b' | Should -BeExactly 'a b'
    }
}

Describe 'None from -o tsv in the other readers' {
    BeforeEach {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        Mock Invoke-DemoSmoke { $true }
        $script:Responses = @(
            @{ Pattern = '^az containerapp show --name web .*ingress.fqdn'; Value = 'None' },
            @{ Pattern = '^az deployment group show'; Throw = 'az deployment group show failed (exit code 3).' }
        ) + $script:Responses
    }
    It 'Get-DeployOutput refuses a None ingress FQDN instead of returning https://None' {
        { Get-DeployOutput -ResourceGroup 'rg' -DeploymentName 'x' } | Should -Throw '*no ingress FQDN*'
    }
    It 'the Smoke action refuses a None ingress FQDN instead of smoke testing https://None' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo
        { Invoke-Smoke -Config $config } | Should -Throw '*No web FQDN*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
}

# ======================================================================================================================
Describe 'Build arguments' {
    It 'passes NEXT_PUBLIC_SB_DEMO= (empty) to the web build and never 0' {
        $arguments = @(Get-WebBuildArgument -Image $script:WebImage -Context 'C:\x\frontend' -Tag 'relcheck-1')
        $arguments | Should -Contain 'NEXT_PUBLIC_SB_DEMO='
        $arguments | Should -Contain 'APP_VERSION=relcheck-1'
        @($arguments | Where-Object { $_ -match 'NEXT_PUBLIC_SB_DEMO=.+' }).Count | Should -Be 0
        $arguments | Should -Not -Contain 'NEXT_PUBLIC_SB_DEMO=0'
        $arguments[$arguments.Count - 1] | Should -BeExactly 'C:\x\frontend'
        $arguments | Should -Contain 'linux/amd64'
    }
    It 'builds the api without any demo build argument' {
        $arguments = @(Get-ApiBuildArgument -Image $script:ApiImage -Context 'C:\x\backend')
        ($arguments -join ' ') | Should -Not -Match 'NEXT_PUBLIC'
        $arguments | Should -Contain $script:ApiImage
    }
    It 'the root-store script is one line without double quotes (PowerShell 5.1 native argument rules)' {
        $text = Get-RootStoreScript
        $text | Should -Not -Match "[`r`n]"
        $text | Should -Not -Match '"'
        $text | Should -Match 'DigiCert Global Root G2'
        $text | Should -Match 'Microsoft RSA Root Certificate Authority 2017'
    }
}

# ======================================================================================================================
Describe 'Get-MainParamValue (contract with main.bicepparam)' {
    BeforeAll {
        $script:Secrets = [pscustomobject]@{
            pgAdminPassword = 'p' * 64; demoEmployerToken = 't' * 64; accessTokens = '{"x":{}}'
            vapidPublicKey = 'PUB'; vapidPrivateKey = 'PRIV'; vapidSubject = 'mailto:a@b.dev'
        }
        $script:State = [ordered]@{ acrName = 'acrsbtest123'; appsIdentityId = '/subscriptions/s/resourceGroups/r/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-apps' }
    }
    It 'real images: the documented ports, paths and flags, phase 1' {
        $config = New-DeployConfig -RepoRoot $script:FakeRepo
        $v = Get-MainParamValue -Config $config -Secrets $script:Secrets -State $script:State -Tag 'relcheck-1' -PostgresVersion '18' -DeployApps $false -ApiImage $script:ApiImage -WebImage $script:WebImage
        $v['DEPLOY_APPS'] | Should -BeExactly 'false'
        $v['API_TARGET_PORT'] | Should -BeExactly '8000'
        $v['WEB_TARGET_PORT'] | Should -BeExactly '3000'
        $v['API_LIVE_PATH'] | Should -BeExactly '/api/v1/health/live'
        $v['API_READY_PATH'] | Should -BeExactly '/api/v1/health/ready'
        $v['WEB_HEALTH_PATH'] | Should -BeExactly '/api/healthz'
        $v['API_IS_PLACEHOLDER'] | Should -BeExactly 'false'
        $v['WEB_IS_PLACEHOLDER'] | Should -BeExactly 'false'
        $v['JOBS_IMAGE'] | Should -BeExactly 'mcr.microsoft.com/k8se/quickstart-jobs:latest'
        $v['TRUSTED_PROXY_HOPS'] | Should -BeExactly '1'
        $v['SB_RULESET_ID'] | Should -BeExactly ''
        $v['SB_MODEL_ID'] | Should -BeExactly ''
        $v['GIT_SHA'] | Should -BeExactly 'relcheck-1'
        $v['API_IMAGE'] | Should -BeExactly $script:ApiImage
    }
    It 'placeholder: quickstart images on port 80 and path /, phase 2' {
        $config = New-DeployConfig -RepoRoot $script:FakeRepo -Placeholder
        $v = Get-MainParamValue -Config $config -Secrets $script:Secrets -State $script:State -Tag 'placeholder' -PostgresVersion '17' -DeployApps $true
        $v['DEPLOY_APPS'] | Should -BeExactly 'true'
        $v['API_IMAGE'] | Should -BeExactly $script:Placeholder
        $v['WEB_IMAGE'] | Should -BeExactly $script:Placeholder
        $v['API_TARGET_PORT'] | Should -BeExactly '80'
        $v['WEB_TARGET_PORT'] | Should -BeExactly '80'
        $v['API_LIVE_PATH'] | Should -BeExactly '/'
        $v['WEB_HEALTH_PATH'] | Should -BeExactly '/'
        $v['API_IS_PLACEHOLDER'] | Should -BeExactly 'true'
        $v['WEB_IS_PLACEHOLDER'] | Should -BeExactly 'true'
    }
    It 'covers every variable of the contract exactly' {
        $config = New-DeployConfig -RepoRoot $script:FakeRepo
        $v = Get-MainParamValue -Config $config -Secrets $script:Secrets -State $script:State -Tag 't' -PostgresVersion '18' -DeployApps $true -ApiImage 'a' -WebImage 'w'
        (@($v.Keys) | Sort-Object) | Should -Be (@($script:ParamEnvNames) | Sort-Object)
    }
    It 'Set-ProcessEnvironment removes empty values instead of leaving a stale one' {
        $env:SB_MODEL_ID = 'stale'
        Set-ProcessEnvironment -Value @{ SB_MODEL_ID = '' }
        Test-Path Env:\SB_MODEL_ID | Should -BeFalse
    }
}

# ======================================================================================================================
Describe 'InitSecrets' {
    BeforeEach {
        $script:SecretValues = @()
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'generates 64-hex secrets, a consistent sha256 and access-token JSON, and a restricted file' {
        $config = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Initialize-DemoSecret -Config $config }
        $path = Get-SecretsFilePath
        Test-Path -LiteralPath $path | Should -BeTrue
        $s = (Get-Content -LiteralPath $path -Raw) | ConvertFrom-Json
        $s.pgAdminPassword | Should -Match '^[0-9a-f]{64}$'
        $s.demoEmployerToken | Should -Match '^[0-9a-f]{64}$'
        $s.pgAdminPassword | Should -Not -BeExactly $s.demoEmployerToken
        $s.demoEmployerTokenSha256 | Should -Match '^[0-9a-f]{64}$'
        # sha256 of the token, computed independently of the function under test
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $expected = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s.demoEmployerToken))) -replace '-', '').ToLowerInvariant()
        $s.demoEmployerTokenSha256 | Should -BeExactly $expected
        $tokens = $s.accessTokens | ConvertFrom-Json
        @($tokens.PSObject.Properties).Count | Should -Be 1
        $entry = $tokens.PSObject.Properties[$expected].Value
        $entry.actor | Should -BeExactly 'demo-bff'
        $entry.role | Should -BeExactly 'employer'
        $entry.employer_id | Should -BeExactly 'emp-demo'
        $s.vapidSubject | Should -BeExactly 'mailto:ops@acme-demo.dev'
        # only the current user can read it
        $access = @((Get-Acl -LiteralPath $path).Access)
        $access.Count | Should -Be 1
        $access[0].IdentityReference.Value | Should -Match ([regex]::Escape($env:USERNAME) + '$')
        # the output has the path and the PUBLIC key and never a secret (a mask '***' would mean a leak was caught)
        $output | Should -Match ([regex]::Escape($path))
        $output | Should -Match ([regex]::Escape($s.vapidPublicKey))
        foreach ($secret in $s.pgAdminPassword, $s.demoEmployerToken, $s.vapidPrivateKey, $s.accessTokens) { $output.Contains($secret) | Should -BeFalse }
        $output | Should -Not -Match '\*\*\*'
        $output | Should -Match 'password manager'
    }
    It 'is not created inside the repository, and refuses a state directory inside it' {
        $default = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'stellar-blaze-i1\secrets.json'
        { Assert-OutsideRepository -Path $default } | Should -Not -Throw
        $inside = Join-Path -Path $script:RepoDir -ChildPath 'infra\secrets.json'
        { Assert-OutsideRepository -Path $inside } | Should -Throw '*inside the repository*'
        { Assert-OutsideRepository -Path $script:RepoDir } | Should -Throw '*inside the repository*'
        # a sibling folder whose name merely starts like the repository is not inside it
        { Assert-OutsideRepository -Path ($script:RepoDir + '-other\x') } | Should -Not -Throw
        $env:SB_I1_STATE_DIR = Join-Path -Path $script:RepoDir -ChildPath 'tmp-state'
        try {
            $config = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev'
            { Initialize-DemoSecret -Config $config } | Should -Throw '*inside the repository*'
            Test-Path -LiteralPath (Join-Path -Path $script:RepoDir -ChildPath 'tmp-state') | Should -BeFalse
        }
        finally { $env:SB_I1_STATE_DIR = $script:StateDir }
    }
    It 'a second run without -Force leaves the file unchanged; -Force replaces it' {
        $config = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $config } | Out-Null
        $path = Get-SecretsFilePath
        $before = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        $second = Get-InfoText { Initialize-DemoSecret -Config $config }
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash | Should -BeExactly $before
        $second | Should -Match 'NOT changed'
        $forced = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo -Force
        Get-InfoText { Initialize-DemoSecret -Config $forced } | Out-Null
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash | Should -Not -BeExactly $before
    }
    It 'requires a real mailto: address' {
        foreach ($bad in '', 'ops@acme-demo.dev', 'mailto:<your address>', 'mailto:me@example.com', 'mailto:no-at-sign') {
            $config = New-DeployConfig -VapidSubject $bad -RepoRoot $script:FakeRepo
            { Initialize-DemoSecret -Config $config } | Should -Throw '*-VapidSubject*'
        }
        Test-Path -LiteralPath (Get-SecretsFilePath) | Should -BeFalse
    }
    It 'generates a different secret every run' {
        (New-RandomHex) | Should -Not -BeExactly (New-RandomHex)
        (New-RandomHex -ByteCount 16).Length | Should -Be 32
    }
}

Describe 'VAPID key pair' {
    It 'has a 32-byte private key and a 65-byte public key starting 0x04, no padding, base64url' {
        $pair = New-VapidKeyPair
        foreach ($text in $pair.Private, $pair.Public) {
            $text | Should -Match '^[A-Za-z0-9_-]+$'
            $text | Should -Not -Match '='
        }
        $private = [System.Convert]::FromBase64String(($pair.Private.Replace('-', '+').Replace('_', '/')) + '=')
        $private.Length | Should -Be 32
        $padded = $pair.Public.Replace('-', '+').Replace('_', '/')
        while ($padded.Length % 4 -ne 0) { $padded += '=' }
        $public = [System.Convert]::FromBase64String($padded)
        $public.Length | Should -Be 65
        $public[0] | Should -Be 0x04
    }
    It 'keeps 32 bytes when the private scalar has leading zero bytes' {
        $lengths = 1..40 | ForEach-Object { $p = New-VapidKeyPair; ([System.Convert]::FromBase64String(($p.Private.Replace('-', '+').Replace('_', '/')) + '=')).Length }
        @($lengths | Where-Object { $_ -ne 32 }).Count | Should -Be 0
    }
    It 'the public key belongs to the private key (a signature made with one verifies with the other)' {
        $pair = New-VapidKeyPair
        $d = [System.Convert]::FromBase64String(($pair.Private.Replace('-', '+').Replace('_', '/')) + '=')
        $padded = $pair.Public.Replace('-', '+').Replace('_', '/')
        while ($padded.Length % 4 -ne 0) { $padded += '=' }
        $q = [System.Convert]::FromBase64String($padded)
        $curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
        $x = New-Object byte[] 32; $y = New-Object byte[] 32
        [System.Array]::Copy($q, 1, $x, 0, 32); [System.Array]::Copy($q, 33, $y, 0, 32)
        $point = New-Object System.Security.Cryptography.ECPoint
        $point.X = $x; $point.Y = $y
        $signer = New-Object System.Security.Cryptography.ECParameters
        $signer.Curve = $curve; $signer.D = $d; $signer.Q = $point
        $verifier = New-Object System.Security.Cryptography.ECParameters
        $verifier.Curve = $curve; $verifier.Q = $point
        $signKey = [System.Security.Cryptography.ECDsa]::Create($signer)
        $verifyKey = [System.Security.Cryptography.ECDsa]::Create($verifier)
        $data = [System.Text.Encoding]::UTF8.GetBytes('vapid')
        $signature = $signKey.SignData($data, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        $verifyKey.VerifyData($data, $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256) | Should -BeTrue
        $other = New-VapidKeyPair
        $otherPadded = $other.Public.Replace('-', '+').Replace('_', '/')
        while ($otherPadded.Length % 4 -ne 0) { $otherPadded += '=' }
        $oq = [System.Convert]::FromBase64String($otherPadded)
        $ox = New-Object byte[] 32; $oy = New-Object byte[] 32
        [System.Array]::Copy($oq, 1, $ox, 0, 32); [System.Array]::Copy($oq, 33, $oy, 0, 32)
        $otherPoint = New-Object System.Security.Cryptography.ECPoint
        $otherPoint.X = $ox; $otherPoint.Y = $oy
        $wrong = New-Object System.Security.Cryptography.ECParameters
        $wrong.Curve = $curve; $wrong.Q = $otherPoint
        $wrongKey = [System.Security.Cryptography.ECDsa]::Create($wrong)
        $wrongKey.VerifyData($data, $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256) | Should -BeFalse
    }
}

Describe 'Against the real api image' -Tag 'Docker' {
    It 'py_vapid loads the generated private key string (as webpush.py hands it to pywebpush) and derives the same public key' -Skip:(-not $script:DockerImageAvailable) {
        $pair = New-VapidKeyPair
        $env:SB_TEST_VK = $pair.Private
        try {
            $python = "import os,base64;from py_vapid import Vapid;from cryptography.hazmat.primitives import serialization as s;v=Vapid.from_string(private_key=os.environ['SB_TEST_VK']);p=v.public_key.public_bytes(s.Encoding.X962,s.PublicFormat.UncompressedPoint);print(base64.urlsafe_b64encode(p).rstrip(b'=').decode())"
            $derived = Invoke-Native -FilePath 'docker' -Arguments 'run', '--rm', '-e', 'SB_TEST_VK', '--entrypoint', 'python', 'stellar-blaze-api:i1', '-c', $python
        }
        finally { Remove-Item Env:\SB_TEST_VK -ErrorAction SilentlyContinue }
        $derived | Should -BeExactly $pair.Public
    }
    It 'the root-store check passes on the real image and FAILS for a name that is not in the store' -Skip:(-not $script:DockerImageAvailable) {
        { Test-ApiImageRootStore -Image 'stellar-blaze-api:i1' } | Should -Not -Throw
        { Test-ApiImageRootStore -Image 'stellar-blaze-api:i1' -RequiredCommonName 'DigiCert Global Root G2', 'No Such Root CA' } | Should -Throw '*No Such Root CA*'
    }
}

# ======================================================================================================================
Describe 'Teardown' {
    It 'prints the delete command and never calls az' {
        Mock Invoke-Native { throw 'Teardown must not call any native command' }
        $config = New-DeployConfig -ResourceGroup 'rg-stellarblaze-demo-uaenorth' -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Show-Teardown -Config $config }
        $output | Should -Match 'az group delete --name rg-stellarblaze-demo-uaenorth --yes --no-wait'
        $output | Should -Match 'deletes EVERYTHING'
        $output | Should -Match 'subscription budget'
        $output | Should -Match 'az group exists --name rg-stellarblaze-demo-uaenorth'
        Should -Invoke Invoke-Native -Times 0 -Exactly
    }
}

# ======================================================================================================================
Describe 'Deploy' {
    BeforeAll {
        # Real secrets and state first (real icacls), the mocks afterwards.
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
        $script:PlainSecrets = (Get-Content -LiteralPath (Get-SecretsFilePath) -Raw) | ConvertFrom-Json
        # The stored database URL as `secret list --show-values` returns it: it carries the REAL password, so a leak is visible.
        $script:DatabaseUrlValue = "postgresql+asyncpg://sbadmin:$($script:PlainSecrets.pgAdminPassword)@psql-test.postgres.database.azure.com:5432/stellar_blaze?ssl=verify-full"
    }
    BeforeEach {
        $script:SecretValues = @()
        $script:CompiledTemplate = New-CompiledTemplateText
        $script:RootCertValue = '/etc/ssl/certs/ca-certificates.crt'
        $script:Epoch = 1
        Save-StateFile -Update @{
            acrName = 'acrsbtest123'; acrLoginServer = $script:Registry; resourceGroupName = 'rg-test'; location = 'uaenorth'
            appsIdentityId = '/subscriptions/s/resourceGroups/rg-test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-apps'
            postgresVersion = '18'; postgresVersionDeployed = ''; placeholder = $false
        }
        Set-NativeMock
        $script:JobImage = $script:ApiImage
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        # Markers in the call list make the order of waits and of the smoke test visible next to the az calls.
        Mock Start-DeployDelay { $script:Calls.Add('<wait>') }
        Mock Invoke-DemoSmoke { $script:Calls.Add('<smoke>'); $script:StateAtSmoke = Read-StateFile; return $true }
        $script:Config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -RepoRoot $script:FakeRepo
    }

    It 'runs the steps in order: login, build, root-store check, push, phase 1, migrate, phase 2, gates, smoke' {
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        $login = Get-CallIndex -Pattern '^az acr login'
        $buildApi = Get-CallIndex -Pattern '^docker build .*sb-api'
        $buildWeb = Get-CallIndex -Pattern '^docker build .*sb-web'
        $rootStore = Get-CallIndex -Pattern '^docker run .*--entrypoint python'
        $pushApi = Get-CallIndex -Pattern '^docker push .*sb-api'
        $pushWeb = Get-CallIndex -Pattern '^docker push .*sb-web'
        $phase1 = Get-CallIndex -Pattern '^az deployment group create .*sb-main-p1-relcheck-1'
        $jobStart = Get-CallIndex -Pattern '^az containerapp job start'
        $phase2 = Get-CallIndex -Pattern '^az deployment group create .*sb-main-p2-relcheck-1'
        $gate = Get-CallIndex -Pattern '^az containerapp revision show'
        $login | Should -BeGreaterThan -1
        $buildApi | Should -BeGreaterThan $login
        $buildWeb | Should -BeGreaterThan $buildApi
        $rootStore | Should -BeGreaterThan $buildWeb
        $pushApi | Should -BeGreaterThan $rootStore
        $pushWeb | Should -BeGreaterThan $pushApi
        $phase1 | Should -BeGreaterThan $pushWeb
        $jobStart | Should -BeGreaterThan $phase1
        $phase2 | Should -BeGreaterThan $jobStart
        $gate | Should -BeGreaterThan $phase2
        Should -Invoke Invoke-DemoSmoke -Times 1 -Exactly
        $output | Should -Match 'https://web.test.example'
        $output | Should -Match 'ResetDemo'
        $output | Should -Not -Match 'ResetClock'
        $output | Should -Match 'INTERNAL'
    }
    It 'builds with exactly NEXT_PUBLIC_SB_DEMO= and the commit as APP_VERSION, and never passes 0' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $web = @($script:Calls | Where-Object { $_ -match '^docker build .*sb-web' })
        $web.Count | Should -Be 1
        $web[0] | Should -Match '--build-arg NEXT_PUBLIC_SB_DEMO= --tag'
        $web[0] | Should -Match '--build-arg APP_VERSION=relcheck-1 '
        $web[0] | Should -Not -Match 'NEXT_PUBLIC_SB_DEMO=0'
        @($script:Calls | Where-Object { $_ -match 'NEXT_PUBLIC_SB_DEMO=0' }).Count | Should -Be 0
    }
    It 'runs phase 1 with DEPLOY_APPS=false and phase 2 with DEPLOY_APPS=true, with secrets present only inside the call' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $script:EnvSeen.Count | Should -Be 2
        $script:EnvSeen[0].Apps | Should -BeExactly 'false'
        $script:EnvSeen[1].Apps | Should -BeExactly 'true'
        foreach ($seen in $script:EnvSeen) {
            $seen.HasPassword | Should -BeTrue
            $seen.HasVapid | Should -BeTrue
            $seen.ApiPlaceholder | Should -BeExactly 'false'
            $seen.ApiImage | Should -BeExactly $script:ApiImage
            $seen.WebImage | Should -BeExactly $script:WebImage
            $seen.ApiPort | Should -BeExactly '8000'
            $seen.Hops | Should -BeExactly '1'
            $seen.Ruleset | Should -BeNullOrEmpty
            $seen.Model | Should -BeNullOrEmpty
            $seen.GitSha | Should -BeExactly 'relcheck-1'
        }
        foreach ($name in $script:ParamEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
    }
    It 'never prints a secret and never puts one in an argument' {
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        $everything = ($script:Calls -join "`n")
        foreach ($secret in $script:PlainSecrets.pgAdminPassword, $script:PlainSecrets.demoEmployerToken, $script:PlainSecrets.vapidPrivateKey, $script:PlainSecrets.accessTokens) {
            $output.Contains($secret) | Should -BeFalse
            $everything.Contains($secret) | Should -BeFalse
        }
        # the mask never had to fire
        $output | Should -Not -Match '\*\*\*'
        # deployment calls hide the parameters
        @($script:Calls | Where-Object { $_ -match '^az deployment group create' } | Where-Object { $_ -notmatch '-o none' }).Count | Should -Be 0
    }
    It 'clears the process environment even when a deployment fails' {
        $script:Responses = @(@{ Pattern = '^az deployment group create'; Throw = 'az deployment group create failed (exit code 1). boom' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*boom*'
        foreach ($name in $script:ParamEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
    }
    It 'stops before phase 2 when the migration fails' {
        $script:Responses = @(@{ Pattern = '^az containerapp job execution show'; Value = 'Failed' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*Failed twice*'
        Get-CallCount -Pattern 'sb-main-p2' | Should -Be 0
    }
    It 'fails the deploy when the root store lacks a root, before anything is pushed' {
        $script:Responses = @(@{ Pattern = '^docker run'; Throw = 'docker run (root store check) failed (exit code 1). root store lacks: DigiCert Global Root G2' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*root store lacks*'
        Get-CallCount -Pattern '^docker push' | Should -Be 0
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }
    It 'fails the gate when the new revision never becomes ready (old revision still serving)' {
        $script:Responses = @(@{ Pattern = '^az containerapp revision show --name web'; Value = { return (New-RevisionJsonText -App 'web' -Image "$script:Registry/sb-web:OLD") } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*Revision gate failed*web*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
    It 'gates the alerts worker too' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        Get-CallCount -Pattern '^az containerapp show --name alerts' | Should -BeGreaterThan 0
    }
    It 'refuses a dirty tree without -AllowDirty before building anything' {
        $script:Responses = @(@{ Pattern = '^git -C .* status'; Value = ' M x' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*uncommitted*'
        Get-CallCount -Pattern '^docker build' | Should -Be 0
    }
    It 'refuses to change the PostgreSQL major version of a server that exists' {
        Save-StateFile -Update @{ postgresVersionDeployed = '17' }
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*PostgreSQL 17 already exists*'
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }
    It 'needs Bootstrap first' {
        Remove-Item -LiteralPath (Get-StateFilePath) -Force
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*Bootstrap*'
    }
    It 'with -SkipBuild builds and pushes nothing but checks the images exist in the registry' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -SkipBuild -RepoRoot $script:FakeRepo
        $script:Responses = @(@{ Pattern = '^az acr repository show'; Value = 'sb-api' }) + $script:Responses
        Get-InfoText { Invoke-Deploy -Config $config } | Out-Null
        Get-CallCount -Pattern '^docker (build|push)' | Should -Be 0
        Get-CallCount -Pattern '^az acr repository show' | Should -Be 2
        Get-CallCount -Pattern 'job start' | Should -Be 1
    }
    It 'with -SkipBuild stops when an image is not in the registry' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -SkipBuild -RepoRoot $script:FakeRepo
        $script:Responses = @(@{ Pattern = '^az acr repository show'; Throw = 'az acr repository show failed (exit code 3).' }) + $script:Responses
        { Invoke-Deploy -Config $config } | Should -Throw '*not in the registry*'
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }

    # ---- the checks deploy.yml runs: ADR 0042 (T1-T5) and the exposure and cost guards (S1 S2 S4 S6) ---------------------
    It 'checks the compiled template (T1 T2 T3) before anything is logged in to, built or deployed' {
        Mock Write-Say { $script:Said.Add([string]$Message) }
        $script:Said.Clear()
        Invoke-Deploy -Config $script:Config
        $said = $script:Said -join "`n"
        $said | Should -Match 'PASS T1 '
        $said | Should -Match 'PASS T2 '
        $said | Should -Match 'PASS T3 '
        $build = Get-CallIndex -Pattern '^az bicep build --file .*main\.bicep --stdout'
        $build | Should -BeGreaterThan -1
        $build | Should -BeLessThan (Get-CallIndex -Pattern '^az acr login')
        $build | Should -BeLessThan (Get-CallIndex -Pattern '^docker build')
        $build | Should -BeLessThan (Get-CallIndex -Pattern '^az deployment group create')
    }
    It 'stops before login, build and phase 1 when a template check FAILs' {
        $script:CompiledTemplate = New-CompiledTemplateText -AlertsWithoutCoreEnv
        Mock Write-Say { $script:Said.Add([string]$Message) }
        $script:Said.Clear()
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*T3*'
        ($script:Said -join "`n") | Should -Match 'FAIL T3 '
        Get-CallCount -Pattern '^az acr login' | Should -Be 0
        Get-CallCount -Pattern '^docker build' | Should -Be 0
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }
    It 'stops the same way when the template cannot be built at all' {
        $script:Responses = @(@{ Pattern = '^az bicep build'; Throw = 'az bicep build failed (exit code 1). Error BCP018' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*main.bicep*'
        Get-CallCount -Pattern '^docker build' | Should -Be 0
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }
    It 'checks ADR 0042 on the deployed api, alerts and job-migrate after phase 2 and before the gates, and never prints the stored URL' {
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        $phase2 = Get-CallIndex -Pattern 'sb-main-p2'
        $gate = Get-CallIndex -Pattern '^az containerapp revision show'
        foreach ($pattern in '^az containerapp secret list --name api ', '^az containerapp secret list --name alerts ', '^az containerapp job secret list --name job-migrate ') {
            $at = Get-CallIndex -Pattern $pattern
            $at | Should -BeGreaterThan $phase2
            $at | Should -BeLessThan $gate
        }
        Get-CallCount -Pattern '--show-values' | Should -Be 3
        foreach ($name in 'api', 'alerts', 'job-migrate') {
            $output | Should -Match "PASS T4 $name stores sb-database-url with ssl=verify-full"
            $output | Should -Match "PASS T5 $name has PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt"
        }
        $output.Contains($script:DatabaseUrlValue) | Should -BeFalse
        $output.Contains($script:PlainSecrets.pgAdminPassword) | Should -BeFalse
        ($script:Calls -join "`n").Contains($script:PlainSecrets.pgAdminPassword) | Should -BeFalse
    }
    It 'stops after phase 2, before the gates, the restart and the smoke test, when a deployed database URL lacks ssl=verify-full' {
        $script:Responses = @(@{ Pattern = '^az containerapp secret list --name alerts'; Value = 'postgresql+asyncpg://sbadmin:x@h:5432/stellar_blaze?ssl=require' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*T4*'
        Get-CallCount -Pattern '^az containerapp revision show' | Should -Be 0
        Get-CallCount -Pattern 'revision restart' | Should -Be 0
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
    It 'stops when a deployed app lacks PGSSLROOTCERT' {
        $script:Responses = @(@{ Pattern = '^az containerapp show --name api .*PGSSLROOTCERT'; Value = 'None' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*T5*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
    It 'stops before the restart and the smoke test when the api is public (S4), and has already recorded what is deployed' {
        $script:Responses = @(@{ Pattern = '^az containerapp show --name api .* -o json'; Value = { return (New-AppJsonText -App 'api' -Image $script:ApiImage -External $true) } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*S4*'
        Get-CallCount -Pattern 'revision restart' | Should -Be 0
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
        (Read-StateFile)['lastTag'] | Should -BeExactly 'relcheck-1'
    }
    It 'stops on a cost guard FAIL (S2: web may scale to 3 replicas)' {
        $script:Responses = @(@{ Pattern = '^az containerapp show --name web .* -o json'; Value = { return (New-AppJsonText -App 'web' -Image $script:WebImage -MaxReplicas 3) } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*S2*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
    It 'stops on a cost guard FAIL (S1: a dedicated workload profile exists)' {
        $script:Responses = @(@{ Pattern = '^az containerapp env show'; Value = '{"properties":{"workloadProfiles":[{"name":"Consumption","workloadProfileType":"Consumption"},{"name":"d4","workloadProfileType":"D4"}]}}' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*S1*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
    }
    It 'restarts api, alerts and web together after the gates, then gates again, resets the demo, smoke tests, and resets the demo a last time' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        @($script:Calls | Where-Object { $_ -match 'revision restart' }).Count | Should -Be 3
        $api = Get-CallIndex -Pattern '^az containerapp revision restart --name api '
        $api | Should -BeGreaterThan -1
        # issued back to back: nothing (no wait, no gate poll) between the three
        Get-CallIndex -Pattern '^az containerapp revision restart --name alerts ' | Should -Be ($api + 1)
        Get-CallIndex -Pattern '^az containerapp revision restart --name web ' | Should -Be ($api + 2)
        # after the gates (the first revision show is the first gate) ...
        Get-CallIndex -Pattern '^az containerapp revision show' | Should -BeLessThan $api
        # ... and all issued before the first wait
        $firstWait = Get-CallIndex -Pattern '^<wait>$'
        $firstWait | Should -BeGreaterThan ($api + 2)
        # the gate runs again on the restarted apps ...
        $gateAgain = Get-CallIndex -Pattern '^az containerapp revision show' -After ($api + 2)
        $gateAgain | Should -BeGreaterThan $firstWait
        # ... then the first demo reset, then the smoke test, then the final reset
        $firstReset = Get-CallIndex -Pattern '^curl.exe .*--request POST .*demo-reset'
        $firstReset | Should -BeGreaterThan $gateAgain
        $smoke = Get-CallIndex -Pattern '^<smoke>$'
        $smoke | Should -BeGreaterThan $firstReset
        $lastReset = Get-CallIndex -Pattern '^curl.exe .*demo-reset' -After $smoke
        $lastReset | Should -BeGreaterThan $smoke
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 2
        # the resets restart nothing: all three restarts came before the first reset
        Get-CallCount -Pattern 'revision restart|containerapp update' | Should -Be 3
        $api | Should -BeLessThan $firstReset
    }
    It 'waits for the web before the first reset, and the smoke test runs with the final rate-limit wait' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $healthz = Get-CallIndex -Pattern '^curl.exe .*https://web.test.example/api/healthz' -After (Get-CallIndex -Pattern '^az containerapp revision restart --name web ')
        $healthz | Should -BeGreaterThan -1
        $healthz | Should -BeLessThan (Get-CallIndex -Pattern '^curl.exe .*demo-reset')
        Should -Invoke Invoke-DemoSmoke -Times 1 -Exactly -ParameterFilter { $Fresh }
    }
    It 'POSTs the reset to the demo site through the web, and records both epochs in the state' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $resets = @($script:Calls | Where-Object { $_ -match '^curl.exe .*demo-reset' })
        $resets.Count | Should -Be 2
        foreach ($call in $resets) {
            $call | Should -Match '--request POST'
            $call | Should -Match 'https://web.test.example/api/v1/sites/site-demo-mussafah/demo-reset$'
        }
        $state = Read-StateFile
        $state['epochId'] | Should -BeExactly '3'
        $state['previousEpochId'] | Should -BeExactly '2'
        $state['resetAt'] | Should -BeExactly '2026-11-15T09:00:00Z'
    }
    It 'waits out a short Retry-After once when the FINAL reset is rate limited, then repeats it' {
        $script:Answers = New-Object System.Collections.Generic.Queue[string]
        $script:Answers.Enqueue((New-ResetAnswer))
        $script:Answers.Enqueue((New-CurlResponseText -Status 429 -Body '{"title":"Rate limited"}' -RetryAfter '7'))
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { if ($script:Answers.Count -gt 0) { return $script:Answers.Dequeue() }; return (New-ResetAnswer) } }) + $script:Responses
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 3
        Should -Invoke Start-DeployDelay -Times 1 -Exactly -ParameterFilter { $Seconds -eq 7 }
        $output | Should -Match 'answered 429.*Retry-After 7 s.*trying once more'
    }
    It 'fails the deploy, after the smoke test passed, when the FINAL reset is rate limited twice' {
        $script:Answers = New-Object System.Collections.Generic.Queue[string]
        $script:Answers.Enqueue((New-ResetAnswer))
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { if ($script:Answers.Count -gt 0) { return $script:Answers.Dequeue() }; return (New-CurlResponseText -Status 429 -RetryAfter '5') } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*429*Retry-After: 5 s*ResetDemo*'
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 3
        (Read-StateFile)['smokePassed'] | Should -BeTrue
    }
    It 'does not wait out a long Retry-After (the 10 per hour limit): it fails and says how long' {
        $script:Answers = New-Object System.Collections.Generic.Queue[string]
        $script:Answers.Enqueue((New-ResetAnswer))
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { if ($script:Answers.Count -gt 0) { return $script:Answers.Dequeue() }; return (New-CurlResponseText -Status 429 -RetryAfter '2400') } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*Retry-After: 2400 s*'
        Should -Invoke Start-DeployDelay -Times 0 -Exactly -ParameterFilter { $Seconds -eq 2400 }
    }
    It 'does not smoke test, and does not reset a second time, when the first reset fails' {
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-CurlResponseText -Status 503) } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*HTTP 503*'
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 1
    }
    It 'does not run the final reset after a failed smoke test, and points at ResetDemo for a stop left behind' {
        Mock Invoke-DemoSmoke { return $false }
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*ResetDemo*'
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 1
    }
    It 'does not restart anything, and does not smoke test, when the first gate fails' {
        $script:Responses = @(@{ Pattern = '^az containerapp revision show --name web'; Value = { return (New-RevisionJsonText -App 'web' -Image "$script:Registry/sb-web:OLD") } }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*Revision gate failed*'
        Get-CallCount -Pattern 'revision restart' | Should -Be 0
    }

    # ---- what the state says (ResetDemo, Status and Smoke read it) ---------------------------------------------------------
    It 'records what is deployed BEFORE the smoke test, so a failed smoke test leaves the state of THIS deploy' {
        Save-StateFile -Update @{ placeholder = $true; lastTag = 'placeholder'; webFqdn = 'old.test.example'; apiImage = $script:Placeholder; webImage = $script:Placeholder }
        Mock Invoke-DemoSmoke { $script:StateAtSmoke = Read-StateFile; return $false }
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*demo HTTP checks failed*'
        $atSmoke = $script:StateAtSmoke
        $atSmoke['placeholder'] | Should -BeFalse
        $atSmoke['lastTag'] | Should -BeExactly 'relcheck-1'
        $state = Read-StateFile
        $state['placeholder'] | Should -BeFalse
        $state['lastTag'] | Should -BeExactly 'relcheck-1'
        $state['webFqdn'] | Should -BeExactly 'web.test.example'
        $state['apiImage'] | Should -BeExactly $script:ApiImage
        $state['webImage'] | Should -BeExactly $script:WebImage
        $state['smokePassed'] | Should -BeFalse
        $state['smokeAt'] | Should -Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
    }
    It 'a smoke test that has not run yet is not recorded as passed, whatever the previous deploy said' {
        Save-StateFile -Update @{ smokePassed = $true; smokeAt = '2026-11-01T00:00:00Z' }
        Mock Invoke-DemoSmoke { $script:StateAtSmoke = Read-StateFile; return $true }
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $script:StateAtSmoke['smokePassed'] | Should -BeFalse
        $script:StateAtSmoke['smokeAt'] | Should -BeExactly ''
    }
    It 'records a passed smoke test with its time' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $state = Read-StateFile
        $state['smokePassed'] | Should -BeTrue
        $state['smokeAt'] | Should -Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
    }
    It 'the Smoke action after a failed deploy smoke test runs the FULL demo checks, not only GET /, and records the result' {
        Save-StateFile -Update @{ placeholder = $true; lastTag = 'placeholder'; webFqdn = 'old.test.example' }
        Mock Invoke-DemoSmoke { return $false }
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*demo HTTP checks failed*'
        $script:Calls.Clear()
        Mock Invoke-DemoSmoke { $script:Calls.Add('<smoke again>'); return $true }
        Get-InfoText { Invoke-Smoke -Config $script:Config } | Out-Null
        Get-CallCount -Pattern '^<smoke again>$' | Should -Be 1
        Get-CallCount -Pattern '^curl.exe' | Should -Be 0
        (Read-StateFile)['smokePassed'] | Should -BeTrue
    }
    It 'the Smoke action records a failure too' {
        Mock Invoke-DemoSmoke { return $false }
        { Invoke-Smoke -Config $script:Config } | Should -Throw '*Demo HTTP checks failed*'
        (Read-StateFile)['smokePassed'] | Should -BeFalse
    }

    # ---- -NoRevoke reaches every HTTP check of the deploy path ---------------------------------------------------------------
    It 'passes -NoRevoke to the demo smoke test, and only when asked' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -NoRevoke -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-Deploy -Config $config } | Out-Null
        Should -Invoke Invoke-DemoSmoke -Times 1 -Exactly -ParameterFilter { $NoRevoke }
        $script:Calls.Clear()
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        Should -Invoke Invoke-DemoSmoke -Times 1 -Exactly -ParameterFilter { -not $NoRevoke }
    }
    It 'passes -NoRevoke to the Smoke action' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -NoRevoke -RepoRoot $script:FakeRepo
        Save-StateFile -Update @{ webFqdn = 'web.test.example'; placeholder = $false }
        Get-InfoText { Invoke-Smoke -Config $config } | Out-Null
        Should -Invoke Invoke-DemoSmoke -Times 1 -Exactly -ParameterFilter { $NoRevoke }
    }
}

Describe 'Deploy -Placeholder' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
    }
    BeforeEach {
        $script:SecretValues = @()
        $script:CompiledTemplate = New-CompiledTemplateText
        Save-StateFile -Update @{
            acrName = 'acrsbtest123'; acrLoginServer = $script:Registry; resourceGroupName = 'rg-test'; location = 'uaenorth'
            appsIdentityId = '/subscriptions/s/resourceGroups/rg-test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-apps'
            postgresVersion = '17'; postgresVersionDeployed = ''; placeholder = $false
        }
        Set-NativeMock
        $script:JobImage = $script:ApiImage
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { return ($Name -ne 'docker') }
        Mock Start-DeployDelay { }
        Mock Invoke-DemoSmoke { $true }
        $script:Config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -Placeholder -RepoRoot $script:FakeRepo
        $script:Responses = @(
            @{ Pattern = '^az containerapp show --name (api|web) .* -o json'; Value = {
                    param($line)
                    $null = $line -match '--name (\w+)'
                    return (New-AppJsonText -App $Matches[1] -Image 'mcr.microsoft.com/k8se/quickstart:latest')
                }
            },
            @{ Pattern = '^az containerapp revision show --name (api|web)'; Value = {
                    param($line)
                    $null = $line -match '--name (\w+)'
                    return (New-RevisionJsonText -App $Matches[1] -Image 'mcr.microsoft.com/k8se/quickstart:latest')
                }
            }
        ) + $script:Responses
    }

    It 'skips docker (build, push, root store), git, the migration and the demo smoke test' {
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        Get-CallCount -Pattern '^docker' | Should -Be 0
        Get-CallCount -Pattern '^git' | Should -Be 0
        Get-CallCount -Pattern 'acr login' | Should -Be 0
        Get-CallCount -Pattern 'job (start|show|execution)' | Should -Be 0
        Should -Invoke Invoke-DemoSmoke -Times 0 -Exactly
        $output | Should -Match 'placeholder: no migration'
        $output | Should -Match 'answered 200'
    }
    It 'runs both phases with placeholder images, port 80 and path /, and gates api and web only' {
        Get-InfoText { Invoke-Deploy -Config $script:Config } | Out-Null
        $script:EnvSeen.Count | Should -Be 2
        $script:EnvSeen[0].Apps | Should -BeExactly 'false'
        $script:EnvSeen[1].Apps | Should -BeExactly 'true'
        foreach ($seen in $script:EnvSeen) {
            $seen.ApiPlaceholder | Should -BeExactly 'true'
            $seen.ApiImage | Should -BeExactly $script:Placeholder
            $seen.ApiPort | Should -BeExactly '80'
        }
        Get-CallCount -Pattern '^az containerapp show --name api' | Should -BeGreaterThan 0
        Get-CallCount -Pattern '^az containerapp show --name alerts' | Should -Be 0
        Get-CallCount -Pattern '^curl.exe .*https://web.test.example/' | Should -BeGreaterThan 0
    }
    It 'checks the template and the exposure and cost guards, but not the database TLS of apps that have no database, and restarts nothing' {
        $output = Get-InfoText { Invoke-Deploy -Config $script:Config }
        Get-CallCount -Pattern '^az bicep build' | Should -Be 1
        Get-CallCount -Pattern 'secret list' | Should -Be 0
        Get-CallCount -Pattern 'PGSSLROOTCERT' | Should -Be 0
        Get-CallCount -Pattern 'revision restart' | Should -Be 0
        Get-CallCount -Pattern '^az resource list' | Should -Be 1
        $output | Should -Match 'PASS T1 '
        $output | Should -Match 'PASS S1 '
        $output | Should -Match 'PASS S2 api'
        $output | Should -Match 'PASS S2 web'
        $output | Should -Not -Match 'S2 alerts'
        $output | Should -Match 'SKIP S4 '
        $output | Should -Match 'PASS S6 '
    }
    It 'records the placeholder deploy before its HTTP check, and passes -NoRevoke to it' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -Placeholder -NoRevoke -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-Deploy -Config $config } | Out-Null
        @($script:Calls | Where-Object { $_ -match '^curl.exe ' -and $_ -match '--ssl-revoke-best-effort' }).Count | Should -BeGreaterThan 0
        @($script:Calls | Where-Object { $_ -match '^curl.exe ' -and $_ -match '--ssl-no-revoke' }).Count | Should -Be 0
        $state = Read-StateFile
        $state['placeholder'] | Should -BeTrue
        $state['smokePassed'] | Should -BeTrue
    }
    It 'a placeholder HTTP check that fails leaves the placeholder state with the failed smoke result' {
        $script:Responses = @(@{ Pattern = '^curl.exe '; Value = '503' }) + $script:Responses
        { Invoke-Deploy -Config $script:Config } | Should -Throw '*answered 503*'
        $state = Read-StateFile
        $state['placeholder'] | Should -BeTrue
        $state['webFqdn'] | Should -BeExactly 'web.test.example'
        $state['smokePassed'] | Should -BeFalse
    }
}

# ======================================================================================================================
Describe 'ResetDemo (a new demo epoch through the web; it restarts nothing)' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    BeforeEach {
        $script:Epoch = 1
        Save-StateFile -Update @{ placeholder = $false; resourceGroupName = 'rg-test'; webFqdn = 'web.test.example'; epochId = ''; previousEpochId = ''; resetAt = '' }
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        Mock Start-DeployDelay { }
        $script:Config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo
    }

    It 'POSTs the reset of the demo site through the web, prints the new epoch and the day, records it, and restarts nothing' {
        $output = Get-InfoText { Invoke-ResetDemo -Config $script:Config }
        $posts = @($script:Calls | Where-Object { $_ -match '^curl.exe ' })
        $posts.Count | Should -Be 1
        $posts[0] | Should -Match '--request POST'
        $posts[0] | Should -Match '--header Content-Length: 0'
        $posts[0] | Should -Match 'https://web.test.example/api/v1/sites/site-demo-mussafah/demo-reset$'
        $posts[0] | Should -Not -Match 'Authorization'
        Get-CallCount -Pattern '^az ' | Should -Be 0
        Get-CallCount -Pattern 'revision restart|containerapp update|containerapp job' | Should -Be 0
        $output | Should -Match 'Demo reset: epoch 2 started \(the epoch before was 1\) at 2026-11-15T09:00:00Z'
        $output | Should -Match 'restarts at the replay anchor'
        $output | Should -Match 'about 7 h 20 min'
        $output | Should -Match 'Nothing was restarted'
        $state = Read-StateFile
        $state['epochId'] | Should -BeExactly '2'
        $state['previousEpochId'] | Should -BeExactly '1'
        $state['resetAt'] | Should -BeExactly '2026-11-15T09:00:00Z'
    }
    It 'passes --ssl-revoke-best-effort with -NoRevoke, and only then' {
        Get-InfoText { Invoke-ResetDemo -Config $script:Config } | Out-Null
        Get-CallCount -Pattern 'ssl-revoke' | Should -Be 0
        $script:Calls.Clear()
        $config = New-DeployConfig -ResourceGroup 'rg-test' -NoRevoke -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-ResetDemo -Config $config } | Out-Null
        Get-CallCount -Pattern '^curl.exe .*--ssl-revoke-best-effort' | Should -Be 1
    }
    It 'on a 429 prints the Retry-After, fails, does not wait and does not touch the recorded epoch' {
        Save-StateFile -Update @{ epochId = '9'; previousEpochId = '8' }
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-CurlResponseText -Status 429 -Body '{"title":"Rate limited"}' -RetryAfter '42') } }) + $script:Responses
        { Invoke-ResetDemo -Config $script:Config } | Should -Throw '*429*Retry-After: 42 s*'
        Get-CallCount -Pattern '^curl.exe .*demo-reset' | Should -Be 1
        Should -Invoke Start-DeployDelay -Times 0 -Exactly
        (Read-StateFile)['epochId'] | Should -BeExactly '9'
    }
    It 'on a 429 without a Retry-After header says so' {
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-CurlResponseText -Status 429) } }) + $script:Responses
        { Invoke-ResetDemo -Config $script:Config } | Should -Throw '*Retry-After: none*'
    }
    It 'fails with the status on any other non-2xx answer' -ForEach @(
        @{ Status = 401 }, @{ Status = 404 }, @{ Status = 409 }, @{ Status = 500 }, @{ Status = 503 }
    ) {
        $script:ResetStatus = $Status
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-CurlResponseText -Status $script:ResetStatus -Body '{"title":"x"}') } }) + $script:Responses
        { Invoke-ResetDemo -Config $script:Config } | Should -Throw "*HTTP $Status*"
        (Read-StateFile)['epochId'] | Should -BeExactly ''
    }
    It 'fails clearly when curl gets no answer at all' {
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Throw = 'curl.exe (demo-reset) failed (exit code 7). curl: (7) Failed to connect' }) + $script:Responses
        { Invoke-ResetDemo -Config $script:Config } | Should -Throw '*no HTTP answer*Failed to connect*'
    }
    It 'accepts a 200 whose body is not JSON, says no epoch is recorded, and records none' {
        $script:Responses = @(@{ Pattern = '^curl.exe .*demo-reset'; Value = { return (New-CurlResponseText -Status 200 -Body 'ok') } }) + $script:Responses
        $output = Get-InfoText { Invoke-ResetDemo -Config $script:Config }
        $output | Should -Match 'no epoch'
        (Read-StateFile)['epochId'] | Should -BeExactly ''
    }
    It 'does nothing after a placeholder deploy' {
        Save-StateFile -Update @{ placeholder = $true }
        $output = Get-InfoText { Invoke-ResetDemo -Config $script:Config }
        $output | Should -Match 'placeholder'
        Get-CallCount -Pattern '^curl.exe|^az ' | Should -Be 0
    }
    It 'reads the web FQDN from the app when state.json has none, and refuses a None' {
        Save-StateFile -Remove @('webFqdn')
        $script:Responses = @(@{ Pattern = '^az containerapp show --name web .*ingress.fqdn'; Value = 'web.from-az.example' }) + $script:Responses
        Get-InfoText { Invoke-ResetDemo -Config $script:Config } | Out-Null
        Get-CallCount -Pattern '^curl.exe .*https://web.from-az.example/api/v1/sites/site-demo-mussafah/demo-reset' | Should -Be 1
        $script:Responses = @(@{ Pattern = '^az containerapp show --name web .*ingress.fqdn'; Value = 'None' }) + $script:Responses
        { Invoke-ResetDemo -Config $script:Config } | Should -Throw '*No web FQDN*'
    }
    It 'ConvertFrom-CurlResponse reads status, Retry-After and body of the FINAL response, after a 100 Continue and with a multi-line body' {
        $text = "HTTP/1.1 100 Continue`n`nHTTP/2 429`nretry-after: 12`ncontent-type: application/json`n`n{`n`"a`": 1`n}`n429"
        $parsed = ConvertFrom-CurlResponse -Text $text
        $parsed.Status | Should -Be 429
        $parsed.RetryAfter | Should -BeExactly '12'
        $parsed.Body | Should -Be "{`n`"a`": 1`n}"
        (ConvertFrom-CurlResponse -Text "HTTP/1.1 204 No Content`n`n204").Body | Should -BeExactly ''
        (ConvertFrom-CurlResponse -Text '').Status | Should -Be 0
    }
    It 'the entry script keeps ResetClock as an alias of ResetDemo and says so' {
        $stateDir = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-alias-state-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path -Path $stateDir -ChildPath 'state.json') -Value '{"placeholder":true}'
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $env:SB_I1_STATE_DIR = $stateDir
        try {
            $lines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path -Path $script:ScriptsDir -ChildPath 'deploy-local.ps1') -Action ResetClock 2>&1)
            $code = $LASTEXITCODE
            $named = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path -Path $script:ScriptsDir -ChildPath 'deploy-local.ps1') -Action ResetDemo 2>&1)
            $namedCode = $LASTEXITCODE
        }
        finally {
            $env:SB_I1_STATE_DIR = $script:StateDir
            $ErrorActionPreference = $previous
            Remove-Item -LiteralPath $stateDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        $text = ($lines | ForEach-Object { "$_" }) -join "`n"
        $text | Should -Match 'ResetClock is now called ResetDemo'
        $text | Should -Match 'placeholder'
        $code | Should -Be 0
        (($named | ForEach-Object { "$_" }) -join "`n") | Should -Not -Match 'ResetClock'
        $namedCode | Should -Be 0
    }
}

Describe 'Status' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    BeforeEach {
        Save-StateFile -Update @{ placeholder = $false; resourceGroupName = 'rg-test'; lastTag = 'relcheck-1'; smokePassed = $true; smokeAt = '2026-11-15T10:00:00Z' }
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        $script:Config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo
    }
    It 'shows the anchor and the last recorded reset, says it cannot see the epoch, and reads no replica' {
        $hourAgo = (Get-Date).ToUniversalTime().AddHours(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        Save-StateFile -Update @{ epochId = '3'; resetAt = $hourAgo }
        $output = Get-InfoText { Invoke-Status -Config $script:Config }
        Get-CallCount -Pattern 'replica' | Should -Be 0
        $output | Should -Match 'Replay anchor \(SB_REPLAY_NOW\): 2026-06-14T10:10:00\+04:00'
        $output | Should -Match 'Status cannot see the epoch'
        $output | Should -Match 'about 7 h 20 min'
        $output | Should -Match 'Last reset recorded by this script: epoch 3, '
        $output | Should -Match '\(1\.0 h ago\)'
        $output | Should -Not -Match 'replay clock (api|alerts)'
        $output | Should -Not -Match 'WARN'
        $output | Should -Match 'Last smoke test: passed at 2026-11-15T10:00:00Z'
    }
    It 'warns when the recorded reset is older than the demo day' {
        $old = (Get-Date).ToUniversalTime().AddHours(-9).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        Save-StateFile -Update @{ epochId = '3'; resetAt = $old }
        $output = Get-InfoText { Invoke-Status -Config $script:Config }
        $output | Should -Match 'WARN more than about 7 h 20 min since that reset'
    }
    It 'says no reset is recorded when there is none' {
        Save-StateFile -Update @{ epochId = ''; resetAt = '' }
        $output = Get-InfoText { Invoke-Status -Config $script:Config }
        $output | Should -Match 'has recorded no reset yet'
    }
}

# ======================================================================================================================
Describe 'Doctor' {
    BeforeEach {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        Set-NativeMock
        $sku18 = '[{"name":"Standard_B1ms","supportedServerVersions":[{"name":"18"},{"name":"17"}]}]'
        $script:Responses = @(
            @{ Pattern = '^az version'; Value = '{"azure-cli":"2.93.0"}' },
            @{ Pattern = '^az bicep version'; Value = 'Bicep CLI version 0.49.2 (abc)' },
            @{ Pattern = '^az provider show --namespace Microsoft.App --query resourceTypes'; Value = '["East US","UAE North"]' },
            @{ Pattern = '^az provider show --namespace .* registrationState'; Value = 'Registered' },
            @{ Pattern = '^az postgres flexible-server list-skus'; Value = $sku18 },
            @{ Pattern = '^az ad signed-in-user'; Value = 'oid-1' },
            @{ Pattern = '^az role assignment list'; Value = 'Owner' }
        ) + (Get-DefaultResponse)
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        $script:Config = New-DeployConfig -Location 'uaenorth' -RepoRoot $script:FakeRepo
    }

    It 'passes everything on a healthy account and records PostgreSQL 18' {
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 0
        $output | Should -Match 'PASS signed-in user is Owner'
        $output | Should -Match 'PASS PostgreSQL Standard_B1ms offered in uaenorth; a version 18 entry exists'
        ([regex]::Matches($output, 'PASS provider ')).Count | Should -Be 7
        (Read-StateFile)['postgresVersion'] | Should -BeExactly '18'
    }
    It 'FAILS with a portal hint when the user is not Owner' {
        $script:Responses = @(@{ Pattern = '^az role assignment list'; Value = '' }) + $script:Responses
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 1
        $output | Should -Match 'FAIL no Owner role assignment.*portal'
    }
    It 'WARNs and picks PostgreSQL 17 when no 18 version appears' {
        $script:Responses = @(@{ Pattern = '^az postgres flexible-server list-skus'; Value = '[{"name":"Standard_B1ms","supportedServerVersions":[{"name":"17"}]}]' }) + $script:Responses
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 0
        $output | Should -Match 'WARN PostgreSQL Standard_B1ms offered in uaenorth but no'
        (Read-StateFile)['postgresVersion'] | Should -BeExactly '17'
    }
    It 'FAILS when Standard_B1ms is not offered, a provider is unregistered, or the region lacks Container Apps' {
        $script:Responses = @(
            @{ Pattern = '^az postgres flexible-server list-skus'; Value = '[{"name":"Standard_D2s"}]' },
            @{ Pattern = '^az provider show --namespace Microsoft.Consumption .*registrationState'; Value = 'NotRegistered' },
            @{ Pattern = '^az provider show --namespace Microsoft.App --query resourceTypes'; Value = '["West Europe"]' }
        ) + $script:Responses
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 3
        $output | Should -Match 'FAIL PostgreSQL Standard_B1ms is not offered'
        $output | Should -Match 'FAIL provider Microsoft.Consumption is NotRegistered'
        $output | Should -Match 'FAIL Microsoft.App managed environments are not offered in uaenorth'
    }
    It 'FAILS cleanly when az is missing and skips every az check' {
        Mock Test-CommandAvailable { return ($Name -ne 'az') }
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 1
        $output | Should -Match 'FAIL az is not on PATH'
        Get-CallCount -Pattern '^az ' | Should -Be 0
    }
    It 'WARNs on an old az and a dirty tree' {
        $script:Responses = @(
            @{ Pattern = '^az version'; Value = '{"azure-cli":"2.80.1"}' },
            @{ Pattern = '^git -C .* status'; Value = ' M x' }
        ) + $script:Responses
        $script:Failures = $null
        $output = Get-InfoText { $script:Failures = Invoke-Doctor -Config $script:Config }
        $script:Failures | Should -Be 0
        $output | Should -Match 'WARN az 2.80.1 is older than 2.92'
        $output | Should -Match 'WARN git working tree has uncommitted changes'
    }
}

# ======================================================================================================================
Describe 'Bootstrap' {
    BeforeEach {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        Set-NativeMock
        $script:BootstrapEnvSeen = New-Object System.Collections.Generic.List[object]
        $outputs = '{"acrName":{"value":"acrsbtest123"},"acrLoginServer":{"value":"acrsbtest123.azurecr.io"},"appsIdentityId":{"value":"/subscriptions/s/id-sb-apps"},"resourceGroupName":{"value":"rg-stellarblaze-demo-uaenorth"},"subscriptionId":{"value":"00000000-0000-0000-0000-000000000001"},"tenantId":{"value":"11111111-2222-3333-4444-555555555555"}}'
        $script:Responses = @(
            @{ Pattern = '^az ad signed-in-user'; Value = '11111111-1111-1111-1111-111111111111' },
            @{ Pattern = '^az deployment sub what-if'; Value = {
                    $script:BootstrapEnvSeen.Add(@{ Step = 'whatif'; Email = $env:BUDGET_CONTACT_EMAIL; Operator = $env:OPERATOR_PRINCIPAL_ID; Month = $env:BUDGET_MONTH; Owner = $env:GITHUB_OWNER; Location = $env:LOCATION })
                    return ''
                }
            },
            @{ Pattern = '^az deployment sub create'; Value = '' },
            @{ Pattern = '^az deployment sub show'; Value = $outputs }
        ) + (Get-DefaultResponse)
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
    }

    It 'exports the bootstrap variables for the process only, creates, stores the outputs and cleans up' {
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Location 'uaenorth' -Yes -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-Bootstrap -Config $config }
        $seen = $script:BootstrapEnvSeen[0]
        $seen.Email | Should -BeExactly 'ali@acme-demo.dev'
        $seen.Operator | Should -BeExactly '11111111-1111-1111-1111-111111111111'
        $seen.Month | Should -Match '^\d{4}-\d{2}$'
        $seen.Owner | Should -BeNullOrEmpty
        $seen.Location | Should -BeExactly 'uaenorth'
        foreach ($name in $script:BootstrapEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
        $state = Read-StateFile
        $state['acrName'] | Should -BeExactly 'acrsbtest123'
        $state['acrLoginServer'] | Should -BeExactly 'acrsbtest123.azurecr.io'
        $state['appsIdentityId'] | Should -BeExactly '/subscriptions/s/id-sb-apps'
        $state['resourceGroupName'] | Should -BeExactly 'rg-stellarblaze-demo-uaenorth'
        $state['budgetMonth'] | Should -Be $seen.Month
        $state['location'] | Should -BeExactly 'uaenorth'
        (Get-CallIndex -Pattern 'sub what-if') | Should -BeLessThan (Get-CallIndex -Pattern 'sub create')
        $output | Should -Match 'WAIT about 10 minutes'
        $output | Should -Match 'retries the migration once'
    }
    It 'reuses the budget month of the first run and passes -GitHubOwner' {
        Save-StateFile -Update @{ budgetMonth = '2026-10' }
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -GitHubOwner 'AliOrg' -Yes -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-Bootstrap -Config $config } | Out-Null
        $script:BootstrapEnvSeen[0].Month | Should -BeExactly '2026-10'
        $script:BootstrapEnvSeen[0].Owner | Should -BeExactly 'AliOrg'
    }
    It 'needs -ContactEmail and creates nothing without it' {
        $config = New-DeployConfig -Yes -RepoRoot $script:FakeRepo
        { Invoke-Bootstrap -Config $config } | Should -Throw '*-ContactEmail*'
        Get-CallCount -Pattern 'sub create' | Should -Be 0
    }
    It 'does not create when the operator declines' {
        Mock Confirm-Action { $false }
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -RepoRoot $script:FakeRepo
        { Invoke-Bootstrap -Config $config } | Should -Throw '*Nothing was created*'
        Get-CallCount -Pattern 'sub create' | Should -Be 0
        foreach ($name in $script:BootstrapEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
    }

    # ---- which subscription state.json belongs to ---------------------------------------------------------------------------
    It 'saves the subscription id and the tenant id of the bootstrap outputs' {
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-Bootstrap -Config $config } | Out-Null
        $state = Read-StateFile
        $state['subscriptionId'] | Should -BeExactly '00000000-0000-0000-0000-000000000001'
        $state['tenantId'] | Should -BeExactly '11111111-2222-3333-4444-555555555555'
    }
    It 'requires the subscription output, so a state file without it is never written' {
        $script:Responses = @(@{ Pattern = '^az deployment sub show .*properties.outputs'; Value = '{"acrName":{"value":"a"},"acrLoginServer":{"value":"a.azurecr.io"},"appsIdentityId":{"value":"/x"},"resourceGroupName":{"value":"rg"}}' }) + $script:Responses
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
        { Invoke-Bootstrap -Config $config } | Should -Throw "*no output 'subscriptionId'*"
    }
    Context 'deployment keys that belong to an earlier life of the resource group' {
        BeforeEach {
            $script:Stale = @{
                postgresVersionDeployed = '18'; lastTag = 'abc123def456'; placeholder = $false; webFqdn = 'web.old.example'; apiFqdn = 'api.old.example'
                apiImage = 'old/api:1'; webImage = 'old/web:1'; smokePassed = $true; smokeAt = '2026-11-01T00:00:00Z'
                subscriptionId = '00000000-0000-0000-0000-000000000001'; budgetMonth = '2026-10'
            }
            Save-StateFile -Update $script:Stale
        }
        It 'keeps them when the group still exists (a re-run to add -GitHubOwner must not forget the deployed PostgreSQL version)' {
            $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -GitHubOwner 'AliOrg' -Yes -RepoRoot $script:FakeRepo
            Get-InfoText { Invoke-Bootstrap -Config $config } | Out-Null
            $state = Read-StateFile
            $state['postgresVersionDeployed'] | Should -BeExactly '18'
            $state['lastTag'] | Should -BeExactly 'abc123def456'
            $state['webFqdn'] | Should -BeExactly 'web.old.example'
            $state['smokePassed'] | Should -BeTrue
            Get-CallCount -Pattern '^az group exists' | Should -Be 1
        }
        It 'clears them when the group is gone (after a Teardown)' {
            $script:Responses = @(@{ Pattern = '^az group exists'; Value = 'false' }) + $script:Responses
            $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
            $output = Get-InfoText { Invoke-Bootstrap -Config $config }
            $state = Read-StateFile
            foreach ($key in 'postgresVersionDeployed', 'lastTag', 'placeholder', 'webFqdn', 'apiFqdn', 'apiImage', 'webImage', 'smokePassed', 'smokeAt') {
                $state.Contains($key) | Should -BeFalse -Because "$key described the deleted deployment"
            }
            # what Bootstrap itself owns is refreshed, and the budget month is kept (the budget outlives the group)
            $state['acrName'] | Should -BeExactly 'acrsbtest123'
            $state['budgetMonth'] | Should -BeExactly '2026-10'
            $output | Should -Match 'earlier deployment'
        }
        It 'clears them, and does not refuse, when az is on another subscription than the one state.json was made for' {
            $script:Responses = @(@{ Pattern = '^az account show'; Value = '{"id":"99999999-9999-9999-9999-999999999999","name":"Other Sub","tenantId":"t","user":{"name":"ali@example.org"}}' }) + $script:Responses
            $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
            $output = Get-InfoText { Invoke-Bootstrap -Config $config }
            $state = Read-StateFile
            $state.Contains('lastTag') | Should -BeFalse
            $state.Contains('postgresVersionDeployed') | Should -BeFalse
            $state['subscriptionId'] | Should -BeExactly '00000000-0000-0000-0000-000000000001'
            $output | Should -Match 'another subscription'
        }
    }

    # ---- BUDGET_MONTH when state.json is lost ----------------------------------------------------------------------------------
    It 'takes -BudgetMonth first, even over the month in state.json' {
        Save-StateFile -Update @{ budgetMonth = '2026-10' }
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -BudgetMonth '2026-09' -Yes -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-Bootstrap -Config $config }
        $script:BootstrapEnvSeen[0].Month | Should -BeExactly '2026-09'
        (Read-StateFile)['budgetMonth'] | Should -BeExactly '2026-09'
        $output | Should -Match 'Budget month: 2026-09 \(-BudgetMonth\)'
    }
    It 'without state.json reads the month from the earlier bootstrap deployment record' {
        $script:Responses = @(@{ Pattern = '^az deployment sub show --name sb-bootstrap --query properties.parameters.budgetMonth.value'; Value = '2026-08' }) + $script:Responses
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-Bootstrap -Config $config }
        $script:BootstrapEnvSeen[0].Month | Should -BeExactly '2026-08'
        $output | Should -Match 'Budget month: 2026-08 \(the earlier bootstrap deployment\)'
    }
    It 'falls back to the current month when there is no deployment record (a first bootstrap), or it holds nothing usable' {
        foreach ($answer in @('None', '', 'not-a-month')) {
            $script:BootstrapEnvSeen.Clear()
            $script:Responses = @(@{ Pattern = '^az deployment sub show --name sb-bootstrap --query properties.parameters.budgetMonth.value'; Value = $answer }) + $script:Responses
            $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
            $output = Get-InfoText { Invoke-Bootstrap -Config $config }
            $script:BootstrapEnvSeen[0].Month | Should -Match '^\d{4}-\d{2}$'
            $output | Should -Match 'Budget month: \d{4}-\d{2} \(this month\)'
            Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        $script:Responses = @(@{ Pattern = '^az deployment sub show --name sb-bootstrap --query properties.parameters.budgetMonth.value'; Throw = 'az deployment sub show failed (exit code 3). DeploymentNotFound' }) + $script:Responses
        $script:BootstrapEnvSeen.Clear()
        $config = New-DeployConfig -ContactEmail 'ali@acme-demo.dev' -Yes -RepoRoot $script:FakeRepo
        Get-InfoText { Invoke-Bootstrap -Config $config } | Out-Null
        $script:BootstrapEnvSeen[0].Month | Should -Match '^\d{4}-\d{2}$'
    }
    It 'rejects a -BudgetMonth that is not yyyy-MM' {
        foreach ($bad in '2026-13', '2026-9', '26-09', 'september', '2026-09-01') {
            { New-DeployConfig -BudgetMonth $bad } | Should -Throw '*yyyy-MM*'
        }
        { New-DeployConfig -BudgetMonth '2026-12' } | Should -Not -Throw
    }
}

Describe 'Invoke-DoctorLite and the subscription of state.json' {
    BeforeEach {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        Set-NativeMock
        $script:Responses = @(@{ Pattern = '^az account show'; Value = '{"id":"AAAAAAAA-0000-0000-0000-000000000001","name":"Real Sub","tenantId":"TTTTTTTT-0000-0000-0000-000000000001","user":{"name":"ali@example.org"}}' }) + $script:Responses
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        Mock Start-DeployDelay { }
    }
    It 'passes when state.json was made for this subscription and tenant (GUID case does not matter)' {
        Save-StateFile -Update @{ subscriptionId = 'aaaaaaaa-0000-0000-0000-000000000001'; tenantId = 'tttttttt-0000-0000-0000-000000000001' }
        { Invoke-DoctorLite -NeedDocker $false } | Should -Not -Throw
    }
    It 'passes for an older state.json that has no subscription id (nothing to compare)' {
        Save-StateFile -Update @{ acrName = 'x' }
        { Invoke-DoctorLite -NeedDocker $false } | Should -Not -Throw
    }
    It 'REFUSES another subscription, names both, and says how to switch' {
        Save-StateFile -Update @{ subscriptionId = 'bbbbbbbb-0000-0000-0000-000000000002' }
        $message = ''
        try { Invoke-DoctorLite -NeedDocker $false } catch { $message = $_.Exception.Message }
        $message | Should -Match 'Pre-checks failed'
        $message | Should -Match 'AAAAAAAA-0000-0000-0000-000000000001'
        $message | Should -Match 'bbbbbbbb-0000-0000-0000-000000000002'
        $message | Should -Match 'az account set --subscription bbbbbbbb-0000-0000-0000-000000000002'
    }
    It 'REFUSES another tenant' {
        Save-StateFile -Update @{ subscriptionId = 'aaaaaaaa-0000-0000-0000-000000000001'; tenantId = 'cccccccc-0000-0000-0000-000000000003' }
        { Invoke-DoctorLite -NeedDocker $false } | Should -Throw '*tenant*cccccccc-0000-0000-0000-000000000003*'
    }
    It 'Validate, Status, Smoke and ResetDemo (when it must look up the web) all go through it, so none of them touches the wrong subscription' {
        Save-StateFile -Update @{ subscriptionId = 'bbbbbbbb-0000-0000-0000-000000000002'; acrName = 'a'; acrLoginServer = 'a.azurecr.io'; appsIdentityId = '/x'; postgresVersion = '17'; placeholder = $false }
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -RepoRoot $script:FakeRepo
        { Invoke-Validate -Config $config } | Should -Throw '*az account set*'
        { Invoke-Status -Config $config } | Should -Throw '*az account set*'
        { Invoke-Smoke -Config $config } | Should -Throw '*az account set*'
        { Invoke-ResetDemo -Config $config } | Should -Throw '*az account set*'
        Get-CallCount -Pattern 'deployment group (create|validate|what-if)' | Should -Be 0
    }
    It 'Deploy refuses it too (secrets present, so the first thing it reaches is the pre-check)' {
        Save-StateFile -Update @{ subscriptionId = 'bbbbbbbb-0000-0000-0000-000000000002'; acrName = 'a'; acrLoginServer = 'a.azurecr.io'; appsIdentityId = '/x'; postgresVersion = '17'; placeholder = $false }
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
        $config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Yes -Placeholder -RepoRoot $script:FakeRepo
        { Invoke-Deploy -Config $config } | Should -Throw '*az account set*'
        Get-CallCount -Pattern 'deployment group (create|validate|what-if)' | Should -Be 0
    }
}

# ======================================================================================================================
Describe 'Validate (read-only dry run)' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
        $script:PlainSecrets = (Get-Content -LiteralPath (Get-SecretsFilePath) -Raw) | ConvertFrom-Json
        $script:WhatIfJson = '{"changes":[{"resourceId":"/a","changeType":"Create"},{"resourceId":"/b","changeType":"Create"},{"resourceId":"/c","changeType":"NoChange"},{"resourceId":"/d","changeType":"Modify"}]}'
    }
    BeforeEach {
        $script:SecretValues = @()
        Save-StateFile -Update @{
            acrName = 'acrsbtest123'; acrLoginServer = $script:Registry; resourceGroupName = 'rg-test'; location = 'uaenorth'
            appsIdentityId = '/subscriptions/s/resourceGroups/rg-test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-apps'
            postgresVersion = '18'
        }
        Set-NativeMock
        $script:Responses = @(
            @{ Pattern = '^az deployment group validate'; Value = {
                    param($line)
                    $script:EnvSeen.Add(@{ Kind = 'validate'; Apps = $env:DEPLOY_APPS; ApiImage = $env:API_IMAGE; WebImage = $env:WEB_IMAGE; ApiPlaceholder = $env:API_IS_PLACEHOLDER; Password = $env:PG_ADMIN_PASSWORD; Line = $line })
                    return ''
                }
            },
            @{ Pattern = '^az deployment group what-if'; Value = {
                    param($line)
                    $script:EnvSeen.Add(@{ Kind = 'whatif'; Apps = $env:DEPLOY_APPS; Line = $line })
                    return $script:WhatIfJson
                }
            }
        ) + (Get-DefaultResponse)
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
        Mock Test-CommandAvailable { $true }
        $script:Config = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -RepoRoot $script:FakeRepo
    }

    It 'validates and what-ifs BOTH phases and never calls deployment group create' {
        $script:Fails = $null
        $output = Get-InfoText { $script:Fails = Invoke-Validate -Config $script:Config }
        $script:Fails | Should -Be 0
        Get-CallCount -Pattern '^az deployment group validate' | Should -Be 2
        Get-CallCount -Pattern '^az deployment group what-if' | Should -Be 2
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
        Get-CallCount -Pattern 'deployment (sub|group) create|job start|acr login|^docker|revision restart|containerapp update' | Should -Be 0
        $apps = @($script:EnvSeen | ForEach-Object { $_.Apps })
        $apps | Should -Be @('false', 'false', 'true', 'true')
        @($script:EnvSeen | Where-Object { $_.Kind -eq 'validate' } | ForEach-Object { $_.Line }) | ForEach-Object { $_ | Should -Match '-o none' }
        $output | Should -Match 'PASS phase 1 \(DEPLOY_APPS=false\) template validation by ARM'
        $output | Should -Match 'PASS phase 2 \(DEPLOY_APPS=true\) template validation by ARM'
        $output | Should -Match 'what-if: 2 create, 1 modify, 0 delete, 1 no change'
        $output | Should -Match 'create and change nothing in Azure and cost nothing'
        $output | Should -Match 'Action Deploy'
        # the what-if asks for ids and change types only: no property value (no secret) comes back
        @($script:Calls | Where-Object { $_ -match 'what-if' })[0] | Should -Match '--result-format ResourceIdOnly'
    }
    It 'uses the validate image tags by default and the quickstart images with -Placeholder' {
        Get-InfoText { Invoke-Validate -Config $script:Config } | Out-Null
        $seen = @($script:EnvSeen | Where-Object { $_.Kind -eq 'validate' })[0]
        $seen.ApiImage | Should -BeExactly "$script:Registry/sb-api:validate"
        $seen.WebImage | Should -BeExactly "$script:Registry/sb-web:validate"
        $seen.ApiPlaceholder | Should -BeExactly 'false'
        Set-NativeMock
        $script:Responses = @(
            @{ Pattern = '^az deployment group validate'; Value = { $script:EnvSeen.Add(@{ Kind = 'validate'; ApiImage = $env:API_IMAGE; ApiPlaceholder = $env:API_IS_PLACEHOLDER }); return '' } },
            @{ Pattern = '^az deployment group what-if'; Value = '{"changes":[]}' }
        ) + (Get-DefaultResponse)
        $placeholder = New-DeployConfig -ResourceGroup 'rg-test' -Location 'uaenorth' -Placeholder -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-Validate -Config $placeholder }
        $script:EnvSeen[0].ApiImage | Should -BeExactly $script:Placeholder
        $script:EnvSeen[0].ApiPlaceholder | Should -BeExactly 'true'
        $output | Should -Match 'Action Deploy -Placeholder'
    }
    It 'reports a validate error as FAIL with the first lines of the error, still runs the rest, and returns non-zero' {
        $script:Responses = @(@{ Pattern = '^az deployment group validate'; Throw = "az deployment group validate failed (exit code 1).`nInvalidTemplate: parameter acrName is wrong`nline two" }) + $script:Responses
        $script:Fails = $null
        $output = Get-InfoText { $script:Fails = Invoke-Validate -Config $script:Config }
        $script:Fails | Should -Be 2
        $output | Should -Match 'FAIL phase 1 \(DEPLOY_APPS=false\) template validation by ARM'
        $output | Should -Match 'InvalidTemplate: parameter acrName is wrong'
        $output | Should -Match 'PASS phase 1 \(DEPLOY_APPS=false\) what-if'
        $output | Should -Match '2 check\(s\) FAILED. Nothing was created'
        Get-CallCount -Pattern 'deployment group create' | Should -Be 0
    }
    It 'reports a what-if error as FAIL' {
        $script:Responses = @(@{ Pattern = '^az deployment group what-if'; Throw = 'az deployment group what-if failed (exit code 1).' }) + $script:Responses
        $script:Fails = $null
        $output = Get-InfoText { $script:Fails = Invoke-Validate -Config $script:Config }
        $script:Fails | Should -Be 2
        $output | Should -Match 'FAIL phase 2 \(DEPLOY_APPS=true\) what-if'
    }
    It 'uses the secrets file when it exists and prints no secret' {
        $output = Get-InfoText { Invoke-Validate -Config $script:Config }
        $password = @($script:EnvSeen | Where-Object { $_.Kind -eq 'validate' })[0].Password
        $password | Should -BeExactly $script:PlainSecrets.pgAdminPassword
        foreach ($secret in $script:PlainSecrets.pgAdminPassword, $script:PlainSecrets.demoEmployerToken, $script:PlainSecrets.vapidPrivateKey, $script:PlainSecrets.accessTokens) {
            $output.Contains($secret) | Should -BeFalse
            ($script:Calls -join "`n").Contains($secret) | Should -BeFalse
        }
        $output | Should -Not -Match '\*\*\*'
        foreach ($name in $script:ParamEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
    }
    It 'without secrets.json uses random throw-away values, creates no file and prints nothing secret' {
        Remove-Item -LiteralPath (Get-SecretsFilePath) -Force
        try {
            $output = Get-InfoText { Invoke-Validate -Config $script:Config }
            $password = [string]@($script:EnvSeen | Where-Object { $_.Kind -eq 'validate' })[0].Password
            $password | Should -Match '^[0-9a-f]{64}$'
            $output.Contains($password) | Should -BeFalse
            $output | Should -Match 'random throw-away values'
            Test-Path -LiteralPath (Get-SecretsFilePath) | Should -BeFalse
            foreach ($name in $script:ParamEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
        }
        finally {
            Write-ProtectedFile -Path (Get-SecretsFilePath) -Text (ConvertTo-Json -InputObject $script:PlainSecrets -Depth 5)
        }
    }
    It 'clears the process environment even when az throws something unexpected' {
        $script:Responses = @(@{ Pattern = '^az deployment group validate'; Value = { throw 'unexpected' } }) + $script:Responses
        { Get-InfoText { Invoke-Validate -Config $script:Config } } | Should -Not -Throw
        foreach ($name in $script:ParamEnvNames) { Test-Path "Env:\$name" | Should -BeFalse }
    }
    It 'needs Bootstrap first' {
        Remove-Item -LiteralPath (Get-StateFilePath) -Force
        { Invoke-Validate -Config $script:Config } | Should -Throw '*Bootstrap*'
    }
    It 'counts what-if change types' {
        $c = Get-WhatIfSummary -Json '{"changes":[{"changeType":"Delete"},{"changeType":"Ignore"},{"changeType":"create"}]}'
        $c.Create | Should -Be 1
        $c.Delete | Should -Be 1
        $c.Other | Should -Be 1
        (Get-WhatIfSummary -Json '{"changes":[]}').Create | Should -Be 0
        (Get-WhatIfSummary -Json '').Create | Should -Be 0
    }
}

Describe 'deploy-local.ps1 -Action Validate (child process, fake az.cmd on PATH)' {
    BeforeAll {
        $script:FakeBin = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-fake-az-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:FakeBin -Force | Out-Null
        $batch = @'
@echo off
if "%1 %2 %3"=="deployment group validate" (echo InvalidTemplate: boom 1>&2 & exit /b 1)
if "%1 %2 %3"=="deployment group what-if" (echo {"changes":[]}& exit /b 0)
if "%1 %2"=="account show" (echo {"id":"00000000-0000-0000-0000-000000000001","name":"Fake Sub","user":{"name":"x@y.dev"}}& exit /b 0)
if "%1 %2"=="extension show" (echo 1.0.0& exit /b 0)
echo unexpected az call %* 1>&2
exit /b 9
'@
        Set-Content -LiteralPath (Join-Path -Path $script:FakeBin -ChildPath 'az.cmd') -Value $batch -Encoding Ascii
        $script:ChildState = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-child-state-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:ChildState -Force | Out-Null
        Set-Content -LiteralPath (Join-Path -Path $script:ChildState -ChildPath 'state.json') -Value '{"acrName":"acrsbtest123","acrLoginServer":"acrsbtest123.azurecr.io","appsIdentityId":"/x","resourceGroupName":"rg-test","location":"uaenorth","postgresVersion":"18"}'
    }
    AfterAll {
        Remove-Item -LiteralPath $script:FakeBin -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ChildState -Recurse -Force -ErrorAction SilentlyContinue
    }
    It 'prints FAIL and exits 1 when az validate fails, and never reaches an az create' {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $savedPath = $env:PATH
        $env:PATH = $script:FakeBin + ';' + $env:PATH
        $env:SB_I1_STATE_DIR = $script:ChildState
        try {
            $lines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path -Path $script:ScriptsDir -ChildPath 'deploy-local.ps1') -Action Validate 2>&1)
            $code = $LASTEXITCODE
        }
        finally {
            $env:PATH = $savedPath
            $env:SB_I1_STATE_DIR = $script:StateDir
            $ErrorActionPreference = $previous
        }
        $text = ($lines | ForEach-Object { "$_" }) -join "`n"
        $text | Should -Match 'FAIL phase 1 \(DEPLOY_APPS=false\) template validation'
        $text | Should -Match 'InvalidTemplate: boom'
        $text | Should -Match 'PASS phase 1 \(DEPLOY_APPS=false\) what-if: 0 create'
        $text | Should -Not -Match 'unexpected az call'
        $code | Should -Be 1
    }
}

# ======================================================================================================================
Describe 'Template TLS checks T1-T3 (ADR 0042, on the compiled main.bicep)' {
    BeforeAll {
        function Get-ResultStatus {
            param($Result, [string]$Id)
            return @($Result | Where-Object { $_.Id -eq $Id })[0].Status
        }
        function Get-ResultReason {
            param($Result, [string]$Id)
            return (@($Result | Where-Object { $_.Id -eq $Id })[0].Reason -join "`n")
        }
    }
    It 'passes a template whose URL verifies the server and whose api, alerts and job-migrate carry PGSSLROOTCERT' {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText))
        @($results | ForEach-Object { $_.Id }) | Should -Be @('T1', 'T2', 'T3')
        @($results | ForEach-Object { $_.Status }) | Should -Be @('PASS', 'PASS', 'PASS')
    }
    It 'T1 FAILS when the database URL has no ssl=verify-full' {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText -UrlSuffix '?ssl=require'))
        Get-ResultStatus -Result $results -Id 'T1' | Should -BeExactly 'FAIL'
        Get-ResultReason -Result $results -Id 'T1' | Should -Match 'lacks ssl=verify-full'
    }
    It 'T1 FAILS when only ONE of the URLs is weak' {
        $text = New-CompiledTemplateText
        $at = $text.IndexOf('ssl=verify-full')
        $weak = $text.Substring(0, $at) + 'ssl=prefer' + $text.Substring($at + 'ssl=verify-full'.Length)
        $results = @(Get-TemplateTlsResult -TemplateJson $weak)
        Get-ResultStatus -Result $results -Id 'T1' | Should -BeExactly 'FAIL'
        Get-ResultStatus -Result $results -Id 'T2' | Should -BeExactly 'FAIL'
    }
    It 'T1 FAILS when the template holds no database URL at all' {
        $results = @(Get-TemplateTlsResult -TemplateJson '{"variables":{},"resources":[]}')
        Get-ResultStatus -Result $results -Id 'T1' | Should -BeExactly 'FAIL'
        Get-ResultReason -Result $results -Id 'T1' | Should -Match 'no database URL'
    }
    It 'T2 FAILS on <_> anywhere in the template, even when the URL itself is fine' -ForEach @('ssl=require', 'ssl=prefer', 'ssl=allow', 'ssl=disable', 'ssl=false', 'sslmode=require', 'SSLMODE=verify-full', 'SSL=REQUIRE') {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText -ExtraVariable "postgresql://u@h/db?$_"))
        Get-ResultStatus -Result $results -Id 'T2' | Should -BeExactly 'FAIL'
    }
    It 'T3 FAILS when alerts does not get the core environment (and names alerts)' {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText -AlertsWithoutCoreEnv))
        Get-ResultStatus -Result $results -Id 'T3' | Should -BeExactly 'FAIL'
        $reason = Get-ResultReason -Result $results -Id 'T3'
        $reason | Should -Match 'alerts'
        $reason | Should -Not -Match 'api:'
        $reason | Should -Not -Match 'job-migrate:'
        Get-ResultStatus -Result $results -Id 'T1' | Should -BeExactly 'PASS'
    }
    It 'T3 FAILS when PGSSLROOTCERT points at another file, for all three' {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText -RootCert '/etc/ssl/other.crt'))
        Get-ResultStatus -Result $results -Id 'T3' | Should -BeExactly 'FAIL'
        $reason = Get-ResultReason -Result $results -Id 'T3'
        foreach ($name in 'api', 'alerts', 'job-migrate') { $reason | Should -Match "$name" }
        $reason | Should -Match '/etc/ssl/other.crt'
    }
    It 'T3 FAILS when a module is missing from the template' {
        $results = @(Get-TemplateTlsResult -TemplateJson (New-CompiledTemplateText -OmitJobModule))
        Get-ResultStatus -Result $results -Id 'T3' | Should -BeExactly 'FAIL'
        Get-ResultReason -Result $results -Id 'T3' | Should -Match 'job-migrate'
    }
    It 'T3 reads the entry when the expression builds it with createObject and the path inline' {
        $entry = "createObject('name', 'PGSSLROOTCERT', 'value', '/etc/ssl/certs/ca-certificates.crt')"
        $module = { param($Name) @{ type = 'Microsoft.Resources/deployments'; name = $Name; properties = @{ parameters = @{ env = @{ value = "[createArray($entry)]" } } } } }
        $template = @{ variables = @{}; resources = @((& $module 'app-api'), (& $module 'app-alerts'), (& $module 'job-migrate')) }
        $results = @(Get-TemplateTlsResult -TemplateJson ($template | ConvertTo-Json -Depth 20))
        Get-ResultStatus -Result $results -Id 'T3' | Should -BeExactly 'PASS'
    }
    It 'T3 FAILS closed, saying why, when the text is not a template' {
        $results = @(Get-TemplateTlsResult -TemplateJson 'this is not json')
        Get-ResultStatus -Result $results -Id 'T3' | Should -BeExactly 'FAIL'
        Get-ResultReason -Result $results -Id 'T3' | Should -Match 'cannot evaluate'
    }
    It 'expects what infra/bicep/main.bicep really declares (drift guard)' {
        $bicep = Get-Content -LiteralPath (Join-Path -Path $script:RepoDir -ChildPath 'infra\bicep\main.bicep') -Raw
        $bicep | Should -Match ([regex]::Escape("var pgSslRootCert = '$($script:ExpectedRootCert)'"))
        $bicep | Should -Match ([regex]::Escape("{ name: 'PGSSLROOTCERT', value: pgSslRootCert }"))
        $bicep | Should -Match ([regex]::Escape("{ name: 'SB_DATABASE_URL', secretRef: '$($script:DatabaseUrlSecretName)' }"))
        $bicep | Should -Match ([regex]::Escape("var databaseUrlSecret = { name: '$($script:DatabaseUrlSecretName)'"))
        foreach ($target in $script:TlsTargets) {
            $bicep | Should -Match ([regex]::Escape("name: '$($target.Module)'")) -Because "the module of $($target.Name) is named $($target.Module)"
        }
        $bicep | Should -Match 'stellar_blaze\?ssl=verify-full'
    }
    It 'Write-GuardResult prints one line per result with the reasons below a FAIL, and returns the number of FAILs' {
        $results = @(
            (New-GuardResult -Status PASS -Id 'T1' -Subject 'fine'),
            (New-GuardResult -Status FAIL -Id 'T3' -Subject 'broken' -Reason @('alerts: no root', 'api: no root')),
            (New-GuardResult -Status SKIP -Id 'S4' -Subject 'placeholder')
        )
        $script:FailCount = -1
        $text = Get-InfoText { $script:FailCount = Write-GuardResult -Result $results }
        $script:FailCount | Should -Be 1
        $text | Should -Match 'PASS T1 fine'
        $text | Should -Match 'FAIL T3 broken'
        $text | Should -Match '  - alerts: no root'
        $text | Should -Match 'SKIP S4 placeholder'
    }
}

Describe 'Deployed TLS checks T4 and T5 (ADR 0042, on what was deployed)' {
    BeforeEach {
        $script:SecretValues = @()
        $password = [guid]::NewGuid().ToString('N')
        $script:DatabaseUrlValue = "postgresql+asyncpg://sbadmin:$password@psql-test.postgres.database.azure.com:5432/stellar_blaze?ssl=verify-full"
        $script:RootCertValue = '/etc/ssl/certs/ca-certificates.crt'
        Register-SecretValue -Value $password
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            foreach ($r in $script:Responses) {
                if ($line -match $r.Pattern) {
                    if ($r.ContainsKey('Throw')) { throw $r.Throw }
                    if ($r.Value -is [scriptblock]) { return (& $r.Value $line) } else { return $r.Value }
                }
            }
            throw "unexpected native call: $line"
        }
    }
    AfterEach { $script:SecretValues = @() }

    It 'passes T4 and T5 for api, alerts and job-migrate, reading the job through the job commands' {
        $results = @(Test-DeployedTlsSetting -ResourceGroup 'rg-test')
        @($results | ForEach-Object { "$($_.Id) $($_.Status)" }) | Should -Be @('T4 PASS', 'T5 PASS', 'T4 PASS', 'T5 PASS', 'T4 PASS', 'T5 PASS')
        Get-CallCount -Pattern '^az containerapp secret list --name api .*--show-values' | Should -Be 1
        Get-CallCount -Pattern '^az containerapp secret list --name alerts .*--show-values' | Should -Be 1
        Get-CallCount -Pattern '^az containerapp job secret list --name job-migrate .*--show-values' | Should -Be 1
        Get-CallCount -Pattern '^az containerapp job show --name job-migrate .*PGSSLROOTCERT' | Should -Be 1
        Get-CallCount -Pattern '^az containerapp show --name api .*PGSSLROOTCERT' | Should -Be 1
    }
    It 'never lets the stored URL into the results, the printed lines or a call line' {
        $results = @(Test-DeployedTlsSetting -ResourceGroup 'rg-test')
        $text = Get-InfoText { Write-GuardResult -Result $results | Out-Null }
        $dump = ($results | ConvertTo-Json -Depth 5) + $text + ($script:Calls -join "`n")
        $dump.Contains($script:DatabaseUrlValue) | Should -BeFalse
        $dump.Contains('sbadmin') | Should -BeFalse
        $dump.Contains('psql-test.postgres') | Should -BeFalse
    }
    It 'T4 FAILS for the one app whose stored URL lacks ssl=verify-full, and only for it' {
        $script:Responses = @(@{ Pattern = '^az containerapp secret list --name alerts'; Value = 'postgresql+asyncpg://sbadmin:x@h:5432/stellar_blaze?ssl=require' }) + $script:Responses
        $results = @(Test-DeployedTlsSetting -ResourceGroup 'rg-test')
        @($results | Where-Object { $_.Status -eq 'FAIL' } | ForEach-Object { "$($_.Id) $($_.Subject)" }) | Should -Be @('T4 alerts: sb-database-url is missing, unreadable, or lacks ssl=verify-full')
    }
    It 'T4 FAILS when the secret is not there (az prints None) or cannot be read, without throwing' {
        $script:Responses = @(
            @{ Pattern = '^az containerapp secret list --name api'; Value = 'None' },
            @{ Pattern = '^az containerapp job secret list'; Throw = 'az containerapp job secret list failed (exit code 1). Forbidden' }
        ) + $script:Responses
        $results = @(Test-DeployedTlsSetting -ResourceGroup 'rg-test')
        @($results | Where-Object { $_.Id -eq 'T4' -and $_.Status -eq 'FAIL' }).Count | Should -Be 2
        (@($results | Where-Object { $_.Id -eq 'T4' -and $_.Subject -match '^job-migrate' })[0].Reason -join ' ') | Should -Match 'Forbidden'
    }
    It 'T5 FAILS when PGSSLROOTCERT differs, is absent (None) or cannot be read' {
        $script:Responses = @(
            @{ Pattern = '^az containerapp show --name api .*PGSSLROOTCERT'; Value = '/somewhere/else.crt' },
            @{ Pattern = '^az containerapp show --name alerts .*PGSSLROOTCERT'; Value = 'None' },
            @{ Pattern = '^az containerapp job show --name job-migrate .*PGSSLROOTCERT'; Throw = 'az containerapp job show failed (exit code 3).' }
        ) + $script:Responses
        $results = @(Test-DeployedTlsSetting -ResourceGroup 'rg-test')
        @($results | Where-Object { $_.Id -eq 'T5' -and $_.Status -eq 'FAIL' }).Count | Should -Be 3
        @($results | Where-Object { $_.Id -eq 'T4' -and $_.Status -eq 'FAIL' }).Count | Should -Be 0
        (@($results | Where-Object { $_.Id -eq 'T5' -and $_.Subject -match '^api' })[0].Subject) | Should -Match '/somewhere/else.crt'
    }
}

Describe 'Exposure and cost guards S1 S2 S4 S6' {
    BeforeAll {
        function New-AppObject {
            param([string]$App, [Nullable[bool]]$External = $null, [int]$MaxReplicas = 1)
            return ((New-AppJsonText -App $App -Image 'x' -External $External -MaxReplicas $MaxReplicas) | ConvertFrom-Json)
        }
        function New-EnvObject {
            param([string]$ProfilesJson)
            return (('{"properties":{"workloadProfiles":' + $ProfilesJson + '}}') | ConvertFrom-Json)
        }
    }
    It 'S1 passes for exactly one Consumption profile' {
        $r = Test-WorkloadProfile -Name 'cae' -Environment (New-EnvObject '[{"name":"Consumption","workloadProfileType":"Consumption"}]')
        $r.Status | Should -BeExactly 'PASS'
        $r.Id | Should -BeExactly 'S1'
    }
    It 'S1 FAILS for a dedicated profile next to Consumption, a dedicated profile alone, a renamed one, or none' -ForEach @(
        @{ Json = '[{"name":"Consumption","workloadProfileType":"Consumption"},{"name":"d4","workloadProfileType":"D4"}]' },
        @{ Json = '[{"name":"d4","workloadProfileType":"D4"}]' },
        @{ Json = '[{"name":"Consumption","workloadProfileType":"D4"}]' },
        @{ Json = '[{"name":"other","workloadProfileType":"Consumption"}]' },
        @{ Json = '[]' },
        @{ Json = 'null' }
    ) {
        (Test-WorkloadProfile -Name 'cae' -Environment (New-EnvObject $Json)).Status | Should -BeExactly 'FAIL'
    }
    It 'S1 FAILS on a private endpoint in the group (each adds a meter), and passes without one' {
        $with = @(ConvertFrom-JsonArray -Text '[{"name":"pe-db","type":"Microsoft.Network/privateEndpoints","location":"uaenorth"},{"name":"api","type":"Microsoft.App/containerApps","location":"uaenorth"}]')
        $r = Test-NoPrivateEndpoint -Resource $with
        $r.Status | Should -BeExactly 'FAIL'
        ($r.Reason -join ' ') | Should -Match 'pe-db'
        $without = @(ConvertFrom-JsonArray -Text '[{"name":"api","type":"Microsoft.App/containerApps","location":"uaenorth"}]')
        (Test-NoPrivateEndpoint -Resource $without).Status | Should -BeExactly 'PASS'
    }
    It 'S2 passes at 1 / 1 replicas and FAILS at <Min> / <Max>' -ForEach @(
        @{ Min = 0; Max = 1 }, @{ Min = 1; Max = 3 }, @{ Min = 2; Max = 2 }
    ) {
        (Test-AppScale -Name 'api' -App (New-AppObject -App 'api')).Status | Should -BeExactly 'PASS'
        $app = New-AppObject -App 'api'
        $app.properties.template.scale.minReplicas = $Min
        $app.properties.template.scale.maxReplicas = $Max
        $r = Test-AppScale -Name 'api' -App $app
        $r.Status | Should -BeExactly 'FAIL'
        $r.Id | Should -BeExactly 'S2'
    }
    It 'S2 FAILS when the scale cannot be read' {
        (Test-AppScale -Name 'api' -App ('{"properties":{"template":{}}}' | ConvertFrom-Json)).Status | Should -BeExactly 'FAIL'
        (Test-AppScale -Name 'api' -App $null).Status | Should -BeExactly 'FAIL'
    }
    It 'S4 passes for the design: api internal, web external, alerts without an ingress' {
        (Test-AppIngress -Name 'api' -App (New-AppObject -App 'api')).Status | Should -BeExactly 'PASS'
        (Test-AppIngress -Name 'web' -App (New-AppObject -App 'web')).Status | Should -BeExactly 'PASS'
        (Test-AppIngress -Name 'alerts' -App (New-AppObject -App 'alerts')).Status | Should -BeExactly 'PASS'
    }
    It 'S4 FAILS when the api is public, the web is not, or the worker has an ingress' {
        $api = Test-AppIngress -Name 'api' -App (New-AppObject -App 'api' -External $true)
        $api.Status | Should -BeExactly 'FAIL'
        ($api.Reason -join ' ') | Should -Match 'must not be public'
        (Test-AppIngress -Name 'web' -App (New-AppObject -App 'web' -External $false)).Status | Should -BeExactly 'FAIL'
        (Test-AppIngress -Name 'alerts' -App (New-AppObject -App 'alerts' -External $false)).Status | Should -BeExactly 'FAIL'
        (Test-AppIngress -Name 'api' -App (New-AppObject -App 'alerts')).Status | Should -BeExactly 'FAIL'
    }
    It 'S6 passes when every resource is in the region, in any spelling of it' {
        $resources = @(ConvertFrom-JsonArray -Text '[{"name":"a","type":"t","location":"uaenorth"},{"name":"b","type":"t","location":"UAE North"}]')
        (Test-ResourceLocation -Resource $resources -Location 'uaenorth').Status | Should -BeExactly 'PASS'
    }
    It 'S6 FAILS for a resource in another region, naming it, and for an empty group' {
        $resources = @(ConvertFrom-JsonArray -Text '[{"name":"a","type":"t","location":"uaenorth"},{"name":"stray","type":"t","location":"westeurope"}]')
        $r = Test-ResourceLocation -Resource $resources -Location 'uaenorth'
        $r.Status | Should -BeExactly 'FAIL'
        ($r.Reason -join ' ') | Should -Match 'stray \(westeurope\)'
        (Test-ResourceLocation -Resource @() -Location 'uaenorth').Status | Should -BeExactly 'FAIL'
    }
}

Describe 'Smoke summary in Status' {
    It 'says passed, failed or not run, with the time' {
        Get-SmokeSummary -State ([ordered]@{ smokePassed = $true; smokeAt = '2026-11-15T10:00:00Z' }) | Should -Match 'passed at 2026-11-15T10:00:00Z'
        Get-SmokeSummary -State ([ordered]@{ smokePassed = $false; smokeAt = '2026-11-15T10:00:00Z' }) | Should -Match 'FAILED at 2026-11-15T10:00:00Z'
        Get-SmokeSummary -State ([ordered]@{ smokePassed = $false; smokeAt = '' }) | Should -Match 'not run'
        Get-SmokeSummary -State ([ordered]@{}) | Should -Match 'not run'
    }
}

Describe 'NoRevoke through the HTTP helpers of the deploy path' {
    BeforeEach {
        Set-NativeMock
        Mock Invoke-Native {
            $line = "$FilePath $($Arguments -join ' ')"
            $script:Calls.Add($line)
            return '200'
        }
        Mock Start-DeployDelay { }
    }
    It 'Get-HttpStatus gives curl --ssl-revoke-best-effort (revoked certificates are still refused) only with -NoRevoke' {
        Get-HttpStatus -Url 'https://web.test.example/' | Should -Be 200
        Get-CallCount -Pattern 'ssl-revoke|ssl-no-revoke' | Should -Be 0
        Get-HttpStatus -Url 'https://web.test.example/' -NoRevoke | Should -Be 200
        Get-CallCount -Pattern '^curl.exe .*--ssl-revoke-best-effort' | Should -Be 1
        Get-CallCount -Pattern '--ssl-no-revoke' | Should -Be 0
    }
    It 'Wait-HttpOk hands it to every poll' {
        Wait-HttpOk -Url 'https://web.test.example/' -NoRevoke
        Get-CallCount -Pattern '^curl.exe .*--ssl-revoke-best-effort' | Should -Be 1
    }
    It 'Invoke-DemoSmoke hands -NoRevoke, and -WaitReady -Wait for a fresh deploy, to Test-DemoHttp.ps1' {
        $fake = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-fake-lib-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $fake -Force | Out-Null
        $marker = Join-Path -Path $fake -ChildPath 'marker.txt'
        $body = @"
param([string]`$BaseUrl, [switch]`$Wait, [switch]`$WaitReady, [switch]`$NoRevoke)
Add-Content -LiteralPath '$marker' -Value ('{0}|{1}|{2}|{3}' -f `$BaseUrl, [bool]`$Wait, [bool]`$WaitReady, [bool]`$NoRevoke)
exit 0
"@
        Set-Content -LiteralPath (Join-Path -Path $fake -ChildPath 'Test-DemoHttp.ps1') -Value $body
        $saved = $script:LibDir
        $script:LibDir = $fake
        try {
            Invoke-DemoSmoke -BaseUrl 'https://a' | Should -BeTrue
            Invoke-DemoSmoke -BaseUrl 'https://b' -Fresh -NoRevoke | Should -BeTrue
            Invoke-DemoSmoke -BaseUrl 'https://c' -NoRevoke | Should -BeTrue
        }
        finally {
            $script:LibDir = $saved
        }
        $lines = @(Get-Content -LiteralPath $marker)
        Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue
        $lines | Should -Be @('https://a|False|False|False', 'https://b|True|True|True', 'https://c|False|False|True')
    }
}

Describe 'ShowSecrets' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
    }
    It 'refuses without -IUnderstand' {
        { Invoke-ShowSecret -Config (New-DeployConfig -RepoRoot $script:FakeRepo) } | Should -Throw '*-IUnderstand*'
    }
    It 'prints exactly the five Render values (unmasked) and a scrollback warning' {
        $script:SecretValues = @()
        $s = (Get-Content -LiteralPath (Get-SecretsFilePath) -Raw) | ConvertFrom-Json
        $output = Get-InfoText { Invoke-ShowSecret -Config (New-DeployConfig -IUnderstand -RepoRoot $script:FakeRepo) }
        $output | Should -Match 'scrollback'
        $output | Should -Match "DEMO_EMPLOYER_TOKEN=$($s.demoEmployerToken)"
        $output | Should -Match 'SB_ACCESS_TOKENS=\{'
        $output | Should -Match "VAPID_PUBLIC_KEY=$($s.vapidPublicKey)"
        $output | Should -Match "SB_VAPID_PRIVATE_KEY=$($s.vapidPrivateKey)"
        $output | Should -Match 'SB_VAPID_SUBJECT=mailto:ops@acme-demo.dev'
        $output.Contains($s.pgAdminPassword) | Should -BeFalse
    }
}

# ======================================================================================================================
Describe 'Test-DemoHttp.ps1 (functions, curl.exe mocked)' {
    BeforeAll {
        . (Join-Path -Path $script:ScriptsDir -ChildPath 'Test-DemoHttp.ps1')
    }
    It 'H5 FAILS when plain http answers 200 on an https deployment' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 200; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H5 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
    }
    It 'H5 passes on a redirect or a refused connection and skips for an http base URL' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 301; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H5 -Base 'https://web.example.test').Status | Should -BeExactly 'PASS'
        Mock Invoke-Curl { [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 7; Error = 'refused' } }
        (Test-H5 -Base 'https://web.example.test').Status | Should -BeExactly 'PASS'
        (Test-H5 -Base 'http://127.0.0.1:3000').Status | Should -BeExactly 'SKIP'
    }
    It 'H4 reads started_at + 4 h as Asia/Dubai time' {
        (Test-H4 -StartedAt '2026-06-14T06:10:03.123456Z').Status | Should -BeExactly 'PASS'
        (Test-H4 -StartedAt '2026-06-14T06:00:00Z').Status | Should -BeExactly 'PASS'
        (Test-H4 -StartedAt '2026-06-14T13:30:00Z').Status | Should -BeExactly 'PASS'
        (Test-H4 -StartedAt '2026-06-14T05:59:59Z').Status | Should -BeExactly 'FAIL'
        (Test-H4 -StartedAt '2026-06-14T13:30:01Z').Status | Should -BeExactly 'FAIL'
        (Test-H4 -StartedAt '2026-06-14T22:00:00Z').Status | Should -BeExactly 'FAIL'
        (Test-H4 -StartedAt '').Status | Should -BeExactly 'FAIL'
        (Test-H4 -StartedAt 'not a date').Status | Should -BeExactly 'FAIL'
    }
    It 'H4 failure says to run ResetDemo (the clock follows the epoch now, a restart no longer moves it)' {
        $subject = (Test-H4 -StartedAt '2026-06-14T13:30:01Z').Subject
        $subject | Should -Match 'run: deploy-local\.ps1 -Action ResetDemo'
        $subject | Should -Not -Match 'ResetClock|restart-replay-clock'
    }
    It 'H6 FAILS when no 429 arrives and passes at the first 429 with Retry-After' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 200; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        $result = Test-H6 -Base 'https://web.example.test'
        $result.Status | Should -BeExactly 'FAIL'
        $result.Subject | Should -Match '200 x30'
        Should -Invoke Invoke-Curl -Times 30 -Exactly
        $script:Count = 0
        Mock Invoke-Curl {
            $script:Count++
            if ($script:Count -ge 5) { return [pscustomobject]@{ Status = 429; Body = ''; Headers = "HTTP/1.1 429 Too Many Requests`r`nRetry-After: 42`r`n`r`n"; ExitCode = 0; Error = '' } }
            return [pscustomobject]@{ Status = 200; Body = ''; Headers = ''; ExitCode = 0; Error = '' }
        }
        $passed = Test-H6 -Base 'https://web.example.test'
        $passed.Status | Should -BeExactly 'PASS'
        $passed.Subject | Should -Match 'Retry-After 42 at request 5'
    }
    It 'H6 sends request i with X-Forwarded-For 203.0.113.i' {
        $script:Seen = New-Object System.Collections.Generic.List[string]
        Mock Invoke-Curl {
            $script:Seen.Add(($Header -join ';'))
            return [pscustomobject]@{ Status = 200; Body = ''; Headers = ''; ExitCode = 0; Error = '' }
        }
        Test-H6 -Base 'https://web.example.test' -Requests 3 | Out-Null
        $script:Seen[0] | Should -BeExactly 'X-Forwarded-For: 203.0.113.1'
        $script:Seen[2] | Should -BeExactly 'X-Forwarded-For: 203.0.113.3'
    }
    It 'H6 counts a request that gets no answer and goes on, like smoke-http.sh (a later 429 still passes)' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 28; Error = 'timeout' } }
        $result = Test-H6 -Base 'https://web.example.test'
        $result.Status | Should -BeExactly 'FAIL'
        $result.Subject | Should -Match 'no answer x30'
        Should -Invoke Invoke-Curl -Times 30 -Exactly
        $script:Count = 0
        Mock Invoke-Curl {
            $script:Count++
            if ($script:Count -eq 1) { return [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 28; Error = 'timeout' } }
            if ($script:Count -ge 3) { return [pscustomobject]@{ Status = 429; Body = ''; Headers = "HTTP/1.1 429`r`nRetry-After: 7`r`n`r`n"; ExitCode = 0; Error = '' } }
            return [pscustomobject]@{ Status = 200; Body = ''; Headers = ''; ExitCode = 0; Error = '' }
        }
        $passed = Test-H6 -Base 'https://web.example.test'
        $passed.Status | Should -BeExactly 'PASS'
        $passed.Subject | Should -Match 'Retry-After 7 at request 3'
    }
    It 'H1 and H2 FAIL with their own id, instead of throwing under strict mode, when the body lacks status, is null, an array or a bare string' -ForEach @(
        @{ Body = '{}' }, @{ Body = 'null' }, @{ Body = '[]' }, @{ Body = '"ok"' }, @{ Body = '{"version":"1"}' }, @{ Body = '' }
    ) {
        $script:Body = $Body
        Mock Invoke-Curl { [pscustomobject]@{ Status = 200; Body = $script:Body; Headers = ''; ExitCode = 0; Error = '' } }
        $h1 = & { Set-StrictMode -Version 2.0; Test-H1 -Base 'https://web.example.test' }
        $h1.Id | Should -BeExactly 'H1'
        $h1.Status | Should -BeExactly 'FAIL'
        $h2 = & { Set-StrictMode -Version 2.0; Test-H2 -Base 'https://web.example.test' }
        $h2.Id | Should -BeExactly 'H2'
        $h2.Status | Should -BeExactly 'FAIL'
    }
    It 'H1 and H2 still pass on a good body under strict mode' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 200; Body = '{"status":"ok","version":"mock-1"}'; Headers = ''; ExitCode = 0; Error = '' } }
        (& { Set-StrictMode -Version 2.0; Test-H1 -Base 'https://web.example.test' }).Status | Should -BeExactly 'PASS'
        (& { Set-StrictMode -Version 2.0; Test-H2 -Base 'https://web.example.test' }).Status | Should -BeExactly 'PASS'
    }
    It 'H3 FAILS when the 201 has no started_at, and still undoes the stop it created' {
        $script:Seen = New-Object System.Collections.Generic.List[string]
        Mock Invoke-Curl {
            $script:Seen.Add("$Method $Url")
            if ($Method -eq 'POST') { return [pscustomobject]@{ Status = 201; Body = '{"id":"stop-1","crew_id":"crew-b"}'; Headers = ''; ExitCode = 0; Error = '' } }
            return [pscustomobject]@{ Status = 204; Body = ''; Headers = ''; ExitCode = 0; Error = '' }
        }
        $result = & { Set-StrictMode -Version 2.0; Test-H3 -Base 'https://web.example.test' }
        $result.Status | Should -BeExactly 'FAIL'
        $result.Id | Should -BeExactly 'H3'
        $result.Subject | Should -Match 'started_at'
        $script:Seen | Should -Contain 'DELETE https://web.example.test/api/v1/crews/crew-b/stops/stop-1'
        $script:Seen | Should -Not -Contain 'GET https://web.example.test/api/v1/crews/crew-b/timeline'
    }
    It 'H3 FAILS when the 201 has no id, and has nothing to undo' {
        $script:Seen = New-Object System.Collections.Generic.List[string]
        Mock Invoke-Curl {
            $script:Seen.Add("$Method $Url")
            return [pscustomobject]@{ Status = 201; Body = '{"started_at":"2026-06-14T06:10:00Z"}'; Headers = ''; ExitCode = 0; Error = '' }
        }
        (Test-H3 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
        @($script:Seen | Where-Object { $_ -like 'DELETE *' }).Count | Should -Be 0
    }
    It 'H3 passes, and hands started_at to H4, when id and started_at are there and the undo is in time' {
        Mock Invoke-Curl {
            if ($Method -eq 'POST') { return [pscustomobject]@{ Status = 201; Body = '{"id":"stop-1","started_at":"2026-06-14T06:10:03.5Z"}'; Headers = ''; ExitCode = 0; Error = '' } }
            if ($Method -eq 'DELETE') { return [pscustomobject]@{ Status = 204; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
            return [pscustomobject]@{ Status = 200; Body = '{"hours":[]}'; Headers = ''; ExitCode = 0; Error = '' }
        }
        $result = Test-H3 -Base 'https://web.example.test'
        $result.Status | Should -BeExactly 'PASS'
        $result.StartedAt | Should -BeExactly '2026-06-14T06:10:03.5Z'
    }
    It 'H5 keeps a non-default port when it builds the plain http URL, and drops nothing else' {
        $script:Url = ''
        Mock Invoke-Curl { $script:Url = $Url; [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 7; Error = 'refused' } }
        Test-H5 -Base 'https://web.example.test:8443' | Out-Null
        $script:Url | Should -BeExactly 'http://web.example.test:8443/api/healthz'
        Test-H5 -Base 'https://web.example.test' | Out-Null
        $script:Url | Should -BeExactly 'http://web.example.test/api/healthz'
    }
    It 'Get-CurlArgument gives --ssl-revoke-best-effort for -NoRevoke, never --ssl-no-revoke, and puts the URL last' {
        $with = @(Get-CurlArgument -Method GET -Url 'https://web.example.test/x' -BodyFile 'b.tmp' -HeaderFile 'h.tmp' -NoRevoke $true)
        $with | Should -Contain '--ssl-revoke-best-effort'
        $with | Should -Not -Contain '--ssl-no-revoke'
        $with[$with.Count - 1] | Should -BeExactly 'https://web.example.test/x'
        $without = @(Get-CurlArgument -Method GET -Url 'https://web.example.test/x' -BodyFile 'b.tmp' -HeaderFile 'h.tmp' -NoRevoke $false)
        $without | Should -Not -Contain '--ssl-revoke-best-effort'
        $without | Should -Not -Contain '--ssl-no-revoke'
    }
    It 'Get-CurlArgument sends headers and a body from a file' {
        $arguments = @(Get-CurlArgument -Method POST -Url 'https://x/y' -Header @('Authorization: Bearer x') -BodyFile 'b.tmp' -HeaderFile 'h.tmp' -RequestFile 'r.tmp' -NoRevoke $false)
        $arguments | Should -Contain 'Authorization: Bearer x'
        $arguments | Should -Contain '@r.tmp'
        $arguments | Should -Contain 'Content-Type: application/json'
    }
    It 'H6 FAILS on a 429 without Retry-After' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 429; Body = ''; Headers = "HTTP/1.1 429`r`n`r`n"; ExitCode = 0; Error = '' } }
        (Test-H6 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
    }
    It 'Wait-DemoWeb polls until /api/healthz answers 200, and gives up at the deadline' {
        Mock Start-Sleep { }
        $script:Answers = New-Object System.Collections.Generic.Queue[int]
        $script:Answers.Enqueue(0); $script:Answers.Enqueue(503); $script:Answers.Enqueue(200)
        Mock Invoke-Curl { [pscustomobject]@{ Status = $script:Answers.Dequeue(); Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        Wait-DemoWeb -Base 'https://web.example.test' -TimeoutSeconds 60 | Should -BeTrue
        Should -Invoke Invoke-Curl -Times 3 -Exactly
        Mock Invoke-Curl { [pscustomobject]@{ Status = 503; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        Wait-DemoWeb -Base 'https://web.example.test' -TimeoutSeconds 0 | Should -BeFalse
    }
    It 'H7 FAILS on 201, 500 and no answer, passes on 401 and 403' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 201; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H7 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
        Mock Invoke-Curl { [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 28; Error = 'timeout' } }
        (Test-H7 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
        Mock Invoke-Curl { [pscustomobject]@{ Status = 500; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H7 -Base 'https://web.example.test').Status | Should -BeExactly 'FAIL'
        Mock Invoke-Curl { [pscustomobject]@{ Status = 403; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H7 -Base 'https://web.example.test').Status | Should -BeExactly 'PASS'
        Mock Invoke-Curl { [pscustomobject]@{ Status = 401; Body = ''; Headers = ''; ExitCode = 0; Error = '' } }
        (Test-H7 -Base 'https://web.example.test').Status | Should -BeExactly 'PASS'
    }
}

Describe 'Test-DemoHttp.ps1 (whole script against a local mock server, real curl.exe)' {
    BeforeAll {
        $script:ServerScript = @'
param([int]$Port, [string]$Scenario, [string]$Started)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
$plans = 0
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath
    $method = $context.Request.HttpMethod
    $response = $context.Response
    $status = 404
    $body = '{}'
    if ($path -eq '/__quit') {
        # Stop-Job cannot interrupt the blocking GetContext call (it takes about a minute), so the tests ask the server to exit.
        $response.StatusCode = 200
        $response.Close()
        $listener.Stop()
        break
    }
    if ($method -eq 'GET' -and $path -eq '/api/healthz') { $status = 200; $body = '{"status":"ok","version":"mock-1"}' }
    elseif ($method -eq 'GET' -and $path -eq '/api/v1/health/ready') { $status = 200; $body = '{"status":"ok","checks":{"database":"ok","config":"ok"}}' }
    elseif ($method -eq 'POST' -and $path -eq '/api/v1/crews/crew-b/stops') { $status = 201; $body = '{"id":"stop-0001","crew_id":"crew-b","started_at":"' + $Started + '","cleared_at":null}' }
    elseif ($method -eq 'DELETE' -and $path -eq '/api/v1/crews/crew-b/stops/stop-0001') { $status = 204; $body = '' }
    elseif ($method -eq 'GET' -and $path -eq '/api/v1/crews/crew-b/timeline') {
        $level = 'orange'
        if ($Scenario -eq 'red') { $level = 'red' }
        $status = 200; $body = '{"crew_id":"crew-b","hours":[{"starts_at":"2026-06-14T06:00:00Z","crew_level":"' + $level + '"}]}'
    }
    elseif ($method -eq 'POST' -and $path -eq '/api/v1/crews/crew-z/stops') {
        $status = 401; $body = '{"title":"Unauthorized"}'
        if ($Scenario -eq 'forged201') { $status = 201; $body = '{"id":"stop-9"}' }
    }
    elseif ($method -eq 'GET' -and $path -eq '/api/v1/crews/crew-b/day-plan') {
        $plans++
        $status = 200; $body = '{"ok":true}'
        if ($Scenario -ne 'nolimit' -and $plans -gt 20) {
            $status = 429; $body = '{"title":"Rate limited"}'
            if ($Scenario -ne 'noretry') { $response.Headers.Add('Retry-After', '30') }
        }
    }
    $response.StatusCode = $status
    if ($status -ne 204) {
        $response.ContentType = 'application/json'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $response.Close()
}
'@
        $script:ServerFile = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('sb-mock-server-' + [guid]::NewGuid().ToString('N') + '.ps1')
        Set-Content -LiteralPath $script:ServerFile -Value $script:ServerScript

        function Start-MockStack {
            param([string]$Scenario = 'ok', [string]$Started = '2026-06-14T06:10:03.5Z')
            $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
            $probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
            $job = Start-Job -FilePath $script:ServerFile -ArgumentList $port, $Scenario, $Started
            $up = $false
            for ($i = 0; $i -lt 60 -and -not $up; $i++) {
                Start-Sleep -Milliseconds 250
                try {
                    $client = New-Object System.Net.Sockets.TcpClient
                    $client.Connect('127.0.0.1', $port)
                    $client.Close()
                    $up = $true
                }
                catch { $up = $false }
            }
            if (-not $up) { Stop-Job -Job $job; Remove-Job -Job $job -Force; throw 'mock server did not start' }
            return [pscustomobject]@{ Job = $job; Url = "http://127.0.0.1:$port" }
        }

        function Stop-MockStack {
            param($Stack)
            $previous = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $null = & curl.exe --silent --max-time 5 --output NUL "$($Stack.Url)/__quit" 2>&1
            $ErrorActionPreference = $previous
            $null = Wait-Job -Job $Stack.Job -Timeout 10
            Stop-Job -Job $Stack.Job -ErrorAction SilentlyContinue
            Remove-Job -Job $Stack.Job -Force -ErrorAction SilentlyContinue
        }

        function Invoke-SmokeScript {
            param([string]$Url)
            $previous = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $lines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path -Path $script:ScriptsDir -ChildPath 'Test-DemoHttp.ps1') -BaseUrl $Url 2>&1)
            $code = $LASTEXITCODE
            $ErrorActionPreference = $previous
            return [pscustomobject]@{ Code = $code; Text = ($lines | ForEach-Object { "$_" }) -join "`n" }
        }
    }
    AfterAll { Remove-Item -LiteralPath $script:ServerFile -Force -ErrorAction SilentlyContinue }

    It 'passes every applicable check against a well-behaved stack and exits 0' {
        $stack = Start-MockStack
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'PASS H1 '
        $run.Text | Should -Match 'PASS H2 '
        $run.Text | Should -Match 'PASS H3 '
        $run.Text | Should -Match 'PASS H4 replay clock reads 10:10 Asia/Dubai'
        $run.Text | Should -Match 'SKIP H5 '
        $run.Text | Should -Match 'PASS H7 '
        $run.Text | Should -Match 'PASS H6 .*Retry-After 30 at request 21'
        $run.Text | Should -Match 'SMOKE OK'
        $run.Code | Should -Be 0
    }
    It 'FAILS H3 and exits 1 when the timeline still shows red' {
        $stack = Start-MockStack -Scenario 'red'
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'FAIL H3 '
        $run.Code | Should -Be 1
    }
    It 'FAILS H4 when the replay clock is outside the window' {
        $stack = Start-MockStack -Started '2026-06-14T14:30:00Z'
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'FAIL H4 .*18:30 Asia/Dubai'
        $run.Code | Should -Be 1
    }
    It 'FAILS H7 when a forged token is accepted' {
        $stack = Start-MockStack -Scenario 'forged201'
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'FAIL H7 '
        $run.Code | Should -Be 1
    }
    It 'FAILS H6 when the rate limit never triggers' {
        $stack = Start-MockStack -Scenario 'nolimit'
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'FAIL H6 .*no 429 in 30 requests'
        $run.Code | Should -Be 1
    }
    It 'FAILS H6 when a 429 has no Retry-After' {
        $stack = Start-MockStack -Scenario 'noretry'
        try { $run = Invoke-SmokeScript -Url $stack.Url } finally { Stop-MockStack -Stack $stack }
        $run.Text | Should -Match 'FAIL H6 .*without Retry-After'
        $run.Code | Should -Be 1
    }
    It 'FAILS H1 and H2 and exits 1 when nothing answers' {
        $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
        $run = Invoke-SmokeScript -Url "http://127.0.0.1:$port"
        $run.Text | Should -Match 'FAIL H1 .*no HTTP answer'
        $run.Text | Should -Match 'FAIL H2 '
        $run.Text | Should -Match 'FAIL H6 .*no answer x30'
        $run.Code | Should -Be 1
    }
    It 'exits 2 with a usage line without a URL' {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path -Path $script:ScriptsDir -ChildPath 'Test-DemoHttp.ps1') 2>&1
        $code = $LASTEXITCODE
        $ErrorActionPreference = $previous
        $code | Should -Be 2
    }
}
