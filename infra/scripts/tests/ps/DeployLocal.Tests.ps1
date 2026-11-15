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
        Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'infra\bicep\main.bicepparam') -Value "using 'main.bicep'"
        Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'infra\bicep\bootstrap.bicepparam') -Value "using 'bootstrap.bicep'"
        return $root
    }

    function New-AppJsonText {
        param([string]$App, [string]$Image)
        $latest = "$App--r1"
        $obj = @{ properties = @{
                latestRevisionName = $latest; latestReadyRevisionName = $latest; provisioningState = 'Succeeded'
                template = @{ containers = @(@{ image = $Image }) }
                configuration = @{ ingress = @{ fqdn = "$App.test.example" } }
            }
        }
        return ($obj | ConvertTo-Json -Depth 10)
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

    # The default answers of the fake az, docker, git and curl.exe for a complete REAL deploy. First match wins.
    function Get-DefaultResponse {
        return @(
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
    }
    BeforeEach {
        $script:SecretValues = @()
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
        Mock Start-DeployDelay { }
        Mock Invoke-DemoSmoke { $true }
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
        $output | Should -Match 'ResetClock'
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
}

Describe 'Deploy -Placeholder' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
        $init = New-DeployConfig -VapidSubject 'mailto:ops@acme-demo.dev' -RepoRoot $script:FakeRepo
        Get-InfoText { Initialize-DemoSecret -Config $init } | Out-Null
    }
    BeforeEach {
        $script:SecretValues = @()
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
}

# ======================================================================================================================
Describe 'ResetClock' {
    BeforeAll {
        Remove-Item -LiteralPath $script:StateDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    BeforeEach {
        Save-StateFile -Update @{ placeholder = $false; resourceGroupName = 'rg-test' }
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
        $script:Responses = @(
            @{ Pattern = '^az containerapp revision restart'; Value = '' },
            @{ Pattern = '^az containerapp update'; Value = '' }
        ) + $script:Responses
    }

    It 'restarts the active revision of api and alerts back to back and warns about desynchronised clocks' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-ResetClock -Config $config }
        $restarts = @($script:Calls | Where-Object { $_ -match 'revision restart' })
        $restarts.Count | Should -Be 2
        $restarts[0] | Should -Match '--name api --resource-group rg-test --revision api--r1'
        $restarts[1] | Should -Match '--name alerts --resource-group rg-test --revision alerts--r1'
        # adjacent: nothing else happens between the two restarts
        (Get-CallIndex -Pattern 'revision restart --name alerts') - (Get-CallIndex -Pattern 'revision restart --name api') | Should -Be 1
        Get-CallCount -Pattern 'containerapp update' | Should -Be 0
        $output | Should -Match 'desynchronises'
        $output | Should -Match 'anchor : 2026-06-14T10:10:00\+04:00'
        $output | Should -Match 'resets SB_REPLAY_NOW'
    }
    It 'with -ReplayNow sets SB_REPLAY_NOW on both apps instead of restarting' {
        $config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo -ReplayNow '2026-06-14T12:00:00+04:00' -ReplayNowExplicit $true
        $output = Get-InfoText { Invoke-ResetClock -Config $config }
        $updates = @($script:Calls | Where-Object { $_ -match 'containerapp update' })
        $updates.Count | Should -Be 2
        $updates[0] | Should -Match '--name api .*--set-env-vars SB_REPLAY_NOW=2026-06-14T12:00:00\+04:00'
        $updates[1] | Should -Match '--name alerts .*--set-env-vars SB_REPLAY_NOW=2026-06-14T12:00:00\+04:00'
        Get-CallCount -Pattern 'revision restart' | Should -Be 0
        $output | Should -Match 'anchor : 2026-06-14T12:00:00\+04:00'
    }
    It 'does nothing after a placeholder deploy' {
        Save-StateFile -Update @{ placeholder = $true }
        $config = New-DeployConfig -ResourceGroup 'rg-test' -RepoRoot $script:FakeRepo
        $output = Get-InfoText { Invoke-ResetClock -Config $config }
        $output | Should -Match 'placeholder'
        Get-CallCount -Pattern 'restart|update' | Should -Be 0
    }
    It 'rejects a -ReplayNow without an offset' {
        { New-DeployConfig -ReplayNow '2026-06-14T10:10:00' } | Should -Throw '*offset*'
        { New-DeployConfig -ReplayNow 'tomorrow+04:00' } | Should -Throw '*not a valid*'
    }
    It 'estimates a replay clock from the process start' {
        $estimate = Get-ReplayClockEstimate -Anchor '2026-06-14T10:10:00+04:00' -StartUtc ([datetime]'2026-11-15T08:00:00Z').ToUniversalTime() -NowUtc ([datetime]'2026-11-15T10:30:00Z').ToUniversalTime()
        $estimate.ToOffset([TimeSpan]::FromHours(4)).ToString('HH:mm') | Should -BeExactly '12:40'
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
        $outputs = '{"acrName":{"value":"acrsbtest123"},"acrLoginServer":{"value":"acrsbtest123.azurecr.io"},"appsIdentityId":{"value":"/subscriptions/s/id-sb-apps"},"resourceGroupName":{"value":"rg-stellarblaze-demo-uaenorth"}}'
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
}

# ======================================================================================================================
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
    It 'H6 stops at the first request that gets no answer instead of waiting for 30 timeouts' {
        Mock Invoke-Curl { [pscustomobject]@{ Status = 0; Body = ''; Headers = ''; ExitCode = 28; Error = 'timeout' } }
        $result = Test-H6 -Base 'https://web.example.test'
        $result.Status | Should -BeExactly 'FAIL'
        Should -Invoke Invoke-Curl -Times 1 -Exactly
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
        $run.Text | Should -Match 'FAIL H6 .*request 1 got no HTTP answer'
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
