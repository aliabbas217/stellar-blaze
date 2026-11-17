#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Test helpers that build fixtures in temp folders; they are not cmdlets.')]
param()
# Pester 5 tests of the pure parts of infra/scripts/validate-local.lib.ps1: the lock file and checksum verification, the
# accepted-risks policy, step selection, exit-code aggregation, the tool-output parsers and the native-command wrapper.
# No network, no Azure, no pinned tool needed (Invoke-WebRequest is mocked; the one real native program is cmd.exe).
#
# Run: infra/validate/pester-run.ps1 -TestPath infra/scripts/tests/ps/ValidateLocal.Tests.ps1 -SummaryPath <file>
#      (validate-local.ps1 -Only script-tests does it), or Invoke-Pester directly.

BeforeAll {
    Set-StrictMode -Version 2.0
    $script:ScriptsDir = (Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..\..')).Path
    $script:RepoDir = (Resolve-Path -LiteralPath (Join-Path -Path $script:ScriptsDir -ChildPath '..\..')).Path
    $script:ValidateDir = Join-Path -Path $script:RepoDir -ChildPath 'infra\validate'
    . (Join-Path -Path $script:ScriptsDir -ChildPath 'validate-local.lib.ps1')

    $script:Temp = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('validate-local-tests-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:Temp -Force | Out-Null

    $script:Today = [datetime]'2026-11-15'

    function Get-ThrownKind {
        param([scriptblock]$Script)
        try { & $Script }
        catch { return (Get-ErrorKind -ErrorRecord $_) }
        return 'none'
    }

    function Get-ThrownMessage {
        param([scriptblock]$Script)
        try { & $Script }
        catch { return $_.Exception.Message }
        return ''
    }

    function New-Risk {
        param(
            [string]$Tool = 'psrule', [string]$RuleId = 'Azure.ContainerApp.MinReplicas', [string]$Resource = 'Microsoft.App/containerApps/api',
            [string]$Reason = 'Scale to zero is the deliberate demo cost decision (ADR 0007).', [string]$Date = '2026-11-15'
        )
        return [pscustomobject]@{ tool = $Tool; ruleId = $RuleId; resource = $Resource; reason = $Reason; date = $Date }
    }

    function Write-JsonFile {
        param([string]$Name, [string]$Content)
        $path = Join-Path -Path $script:Temp -ChildPath $Name
        [System.IO.File]::WriteAllText($path, $Content)
        return $path
    }

    function Get-Sha256Hex {
        param([byte[]]$Bytes)
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try { return (($hasher.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) -join '') }
        finally { $hasher.Dispose() }
    }

    function Get-Sha512Base64 {
        param([byte[]]$Bytes)
        $hasher = [System.Security.Cryptography.SHA512]::Create()
        try { return [Convert]::ToBase64String($hasher.ComputeHash($Bytes)) }
        finally { $hasher.Dispose() }
    }
}

AfterAll {
    if ($script:Temp -and (Test-Path -LiteralPath $script:Temp)) { Remove-Item -LiteralPath $script:Temp -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'tools.lock.json' {
    It 'the committed lock file is well formed and every URL is on the allow-list' {
        $lock = Read-ToolLock -Path (Join-Path -Path $script:ValidateDir -ChildPath 'tools.lock.json')
        $lock.binaries.bicep.version | Should -Not -BeNullOrEmpty
        @(Test-ToolLockObject -Lock $lock).Count | Should -Be 0
    }

    It 'pins every step tool' {
        $lock = Read-ToolLock -Path (Join-Path -Path $script:ValidateDir -ChildPath 'tools.lock.json')
        foreach ($name in @('bicep', 'shellcheck', 'actionlint', 'hadolint', 'trivy', 'act')) { $lock.binaries.PSObject.Properties.Name | Should -Contain $name }
        foreach ($name in @('PSRule', 'PSRule.Rules.Azure', 'Pester', 'PSScriptAnalyzer')) { $lock.psModules.PSObject.Properties.Name | Should -Contain $name }
        $lock.images.checkov.digest | Should -Match '^sha256:[0-9a-f]{64}$'
    }

    It 'rejects <Case>' -ForEach @(
        @{ Case = 'a sha256 that is not 64 hex characters'; Mutate = { param($l) $l.binaries.bicep.sha256 = 'abc123' }; Expect = 'binaries.bicep.sha256' }
        @{ Case = 'a missing exeSha256'; Mutate = { param($l) $l.binaries.hadolint.exeSha256 = '' }; Expect = 'binaries.hadolint.exeSha256' }
        @{ Case = 'an http URL'; Mutate = { param($l) $l.binaries.trivy.url = 'http://github.com/aquasecurity/trivy/x.zip' }; Expect = 'binaries.trivy.url' }
        @{ Case = 'a URL on a host outside the allow-list'; Mutate = { param($l) $l.binaries.act.url = 'https://example.com/act.zip' }; Expect = 'binaries.act.url' }
        @{ Case = 'a module hash that is not base64 SHA512'; Mutate = { param($l) $l.psModules.Pester.sha512 = 'deadbeef' }; Expect = 'psModules.Pester.sha512' }
        @{ Case = 'an image that is not pinned by digest'; Mutate = { param($l) $l.images.checkov.digest = 'latest' }; Expect = 'images.checkov.digest' }
    ) {
        $lock = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText((Join-Path -Path $script:ValidateDir -ChildPath 'tools.lock.json')))
        & $Mutate $lock
        $problems = @(Test-ToolLockObject -Lock $lock)
        ($problems -join "`n") | Should -Match ([regex]::Escape($Expect))
    }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'checksum verification (fail closed)' {
    BeforeAll {
        $script:Payload = [System.Text.Encoding]::UTF8.GetBytes('a pinned tool')
        $script:PayloadPath = Join-Path -Path $script:Temp -ChildPath 'payload.bin'
        [System.IO.File]::WriteAllBytes($script:PayloadPath, $script:Payload)
        $script:Sha256 = Get-Sha256Hex -Bytes $script:Payload
        $script:Sha512 = Get-Sha512Base64 -Bytes $script:Payload
    }

    It 'accepts a matching sha256 (upper or lower case) and a matching base64 sha512' {
        { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA256 -Expected $script:Sha256 } | Should -Not -Throw
        { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA256 -Expected $script:Sha256.ToUpperInvariant() } | Should -Not -Throw
        { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA512 -Expected $script:Sha512 } | Should -Not -Throw
    }

    It 'throws an Integrity error on a wrong sha256 and names expected and actual' {
        $wrong = ('0' * 64)
        (Get-ThrownKind -Script { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA256 -Expected $wrong }) | Should -Be 'Integrity'
        (Get-ThrownMessage -Script { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA256 -Expected $wrong }) | Should -Match $script:Sha256
    }

    It 'throws an Integrity error on a wrong sha512, and the comparison is case-sensitive' {
        (Get-ThrownKind -Script { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA512 -Expected ('A' * 86 + '==') }) | Should -Be 'Integrity'
        (Get-ThrownKind -Script { Assert-FileDigest -Path $script:PayloadPath -Algorithm SHA512 -Expected $script:Sha512.ToLowerInvariant() }) | Should -Be 'Integrity'
    }

    Context 'Save-VerifiedDownload' {
        BeforeEach {
            $script:Destination = Join-Path -Path $script:Temp -ChildPath ('dl-' + [guid]::NewGuid().ToString('N') + '\tool.zip')
            Mock Invoke-WebRequest { [System.IO.File]::WriteAllBytes($OutFile, $script:Payload) }
        }

        It 'keeps the file when the hash matches' {
            Save-VerifiedDownload -Url 'https://github.com/o/r/releases/download/v1/tool.zip' -Destination $script:Destination -Algorithm SHA256 -Expected $script:Sha256
            Test-Path -LiteralPath $script:Destination | Should -BeTrue
            Test-Path -LiteralPath ($script:Destination + '.partial') | Should -BeFalse
        }

        It 'refuses a download whose hash differs and leaves nothing behind' {
            $kind = Get-ThrownKind -Script { Save-VerifiedDownload -Url 'https://github.com/o/r/releases/download/v1/tool.zip' -Destination $script:Destination -Algorithm SHA256 -Expected ('f' * 64) }
            $kind | Should -Be 'Integrity'
            Test-Path -LiteralPath $script:Destination | Should -BeFalse
            Test-Path -LiteralPath ($script:Destination + '.partial') | Should -BeFalse
        }

        It 'does not replace an installed file when the new download is refused' {
            New-Item -ItemType Directory -Path (Split-Path -Path $script:Destination -Parent) -Force | Out-Null
            [System.IO.File]::WriteAllText($script:Destination, 'good file')
            $null = Get-ThrownKind -Script { Save-VerifiedDownload -Url 'https://github.com/o/r/x.zip' -Destination $script:Destination -Algorithm SHA256 -Expected ('f' * 64) }
            [System.IO.File]::ReadAllText($script:Destination) | Should -Be 'good file'
        }

        It 'refuses a URL outside the allow-list without any request' -ForEach @(
            @{ Url = 'http://github.com/o/r/tool.zip' }
            @{ Url = 'https://evil.example.com/tool.zip' }
            @{ Url = 'https://github.com.evil.example.com/tool.zip' }
            @{ Url = 'ftp://github.com/tool.zip' }
        ) {
            (Get-ThrownKind -Script { Save-VerifiedDownload -Url $Url -Destination $script:Destination -Algorithm SHA256 -Expected $script:Sha256 }) | Should -Be 'Integrity'
            Should -Invoke Invoke-WebRequest -Times 0 -Exactly
        }

        It 'reports Unavailable (not Integrity) when the network fails' {
            Mock Invoke-WebRequest { throw 'name resolution failed' }
            (Get-ThrownKind -Script { Save-VerifiedDownload -Url 'https://github.com/o/r/tool.zip' -Destination $script:Destination -Algorithm SHA256 -Expected $script:Sha256 -Attempts 2 }) | Should -Be 'Unavailable'
            Should -Invoke Invoke-WebRequest -Times 2 -Exactly
        }
    }

    Context 'Install-LockedTool' {
        BeforeEach {
            $script:ToolsDir = Join-Path -Path $script:Temp -ChildPath ('tools-' + [guid]::NewGuid().ToString('N'))
            $exeBytes = [System.Text.Encoding]::UTF8.GetBytes('fake executable')
            $script:ExeHash = Get-Sha256Hex -Bytes $exeBytes
            Mock Save-VerifiedDownload {
                New-Item -ItemType Directory -Path (Split-Path -Path $Destination -Parent) -Force | Out-Null
                [System.IO.File]::WriteAllBytes($Destination, [System.Text.Encoding]::UTF8.GetBytes('fake executable'))
            }
        }

        It 'installs an exe whose hash equals the lock and is idempotent afterwards' {
            $entry = [pscustomobject]@{ version = '1.0.0'; url = 'https://github.com/o/r/fake.exe'; kind = 'exe'; sha256 = $script:ExeHash; exe = 'fake.exe'; exeSha256 = $script:ExeHash }
            $context = [pscustomobject]@{ ToolsDir = $script:ToolsDir; Lock = [pscustomobject]@{ binaries = [pscustomobject]@{ fake = $entry } } }
            $path = Install-LockedTool -Context $context -Name 'fake'
            Test-Path -LiteralPath $path | Should -BeTrue
            $null = Install-LockedTool -Context $context -Name 'fake'
            Should -Invoke Save-VerifiedDownload -Times 1 -Exactly
        }

        It 'refuses and installs nothing when the file does not match the lock' {
            $entry = [pscustomobject]@{ version = '1.0.0'; url = 'https://github.com/o/r/fake.exe'; kind = 'exe'; sha256 = $script:ExeHash; exe = 'fake.exe'; exeSha256 = ('0' * 64) }
            $context = [pscustomobject]@{ ToolsDir = $script:ToolsDir; Lock = [pscustomobject]@{ binaries = [pscustomobject]@{ fake = $entry } } }
            (Get-ThrownKind -Script { Install-LockedTool -Context $context -Name 'fake' }) | Should -Be 'Integrity'
            Test-Path -LiteralPath (Join-Path -Path $script:ToolsDir -ChildPath 'bin\fake.exe') | Should -BeFalse
        }

        It 'replaces an installed exe whose hash differs from the lock (a bumped or tampered file)' {
            $entry = [pscustomobject]@{ version = '1.0.0'; url = 'https://github.com/o/r/fake.exe'; kind = 'exe'; sha256 = $script:ExeHash; exe = 'fake.exe'; exeSha256 = $script:ExeHash }
            $context = [pscustomobject]@{ ToolsDir = $script:ToolsDir; Lock = [pscustomobject]@{ binaries = [pscustomobject]@{ fake = $entry } } }
            New-Item -ItemType Directory -Path (Join-Path -Path $script:ToolsDir -ChildPath 'bin') -Force | Out-Null
            $installed = Join-Path -Path $script:ToolsDir -ChildPath 'bin\fake.exe'
            [System.IO.File]::WriteAllText($installed, 'tampered')
            $null = Install-LockedTool -Context $context -Name 'fake'
            (Get-FileDigest -Path $installed -Algorithm SHA256) | Should -Be $script:ExeHash
        }

        It 'fails with Integrity for a tool that is not in the lock' {
            $context = [pscustomobject]@{ ToolsDir = $script:ToolsDir; Lock = [pscustomobject]@{ binaries = [pscustomobject]@{} } }
            (Get-ThrownKind -Script { Install-LockedTool -Context $context -Name 'unknown' }) | Should -Be 'Integrity'
        }
    }

    Context 'Expand-ZipSafely' {
        It 'rejects a zip entry that escapes the destination (zip-slip)' {
            Add-Type -AssemblyName System.IO.Compression
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $zipPath = Join-Path -Path $script:Temp -ChildPath 'slip.zip'
            $stream = [System.IO.File]::Create($zipPath)
            $archive = New-Object System.IO.Compression.ZipArchive -ArgumentList $stream, ([System.IO.Compression.ZipArchiveMode]::Create)
            $entry = $archive.CreateEntry('../escaped.txt')
            $writer = New-Object System.IO.StreamWriter -ArgumentList $entry.Open()
            $writer.Write('x')
            $writer.Dispose()
            $archive.Dispose()
            $stream.Dispose()
            $destination = Join-Path -Path $script:Temp -ChildPath 'slip-out'
            { Expand-ZipSafely -ZipPath $zipPath -Destination $destination } | Should -Throw '*escapes the destination*'
            Test-Path -LiteralPath (Join-Path -Path $script:Temp -ChildPath 'escaped.txt') | Should -BeFalse
        }
    }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'accepted risks' {
    It 'the committed accepted-risks.json is valid' {
        { Read-AcceptedRiskFile -Path (Join-Path -Path $script:ValidateDir -ChildPath 'accepted-risks.json') -Today $script:Today } | Should -Not -Throw
    }

    It 'accepts a complete entry' {
        @(Test-AcceptedRiskEntry -Entry (New-Risk) -Today $script:Today).Count | Should -Be 0
    }

    It 'rejects an entry without a reason' {
        $problems = @(Test-AcceptedRiskEntry -Entry (New-Risk -Reason '') -Today $script:Today)
        ($problems -join '|') | Should -Match 'reason is required'
    }

    It 'rejects a reason that is only whitespace or too short to be a reason' -ForEach @(
        @{ Reason = '      ' }
        @{ Reason = 'ok' }
        @{ Reason = 'because' }
    ) {
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -Reason $Reason) -Today $script:Today)) -join '|') | Should -Match 'reason is required'
    }

    It 'rejects an entry that has no reason property at all' {
        $entry = [pscustomobject]@{ tool = 'psrule'; ruleId = 'Azure.X.Y'; resource = 'r'; date = '2026-11-15' }
        ($(@(Test-AcceptedRiskEntry -Entry $entry -Today $script:Today)) -join '|') | Should -Match 'reason is required'
    }

    It 'rejects a wildcard in the rule id: <RuleId>' -ForEach @(
        @{ RuleId = '*' }
        @{ RuleId = 'Azure.ContainerApp.*' }
        @{ RuleId = 'CKV_AZURE_??' }
        @{ RuleId = 'SC*' }
    ) {
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -RuleId $RuleId) -Today $script:Today)) -join '|') | Should -Match 'ruleId must not contain a wildcard'
    }

    It 'rejects a wildcard resource' {
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -Resource '*') -Today $script:Today)) -join '|') | Should -Match 'resource must not contain a wildcard'
    }

    It 'rejects an empty rule id or resource' {
        $problems = ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -RuleId '' -Resource '') -Today $script:Today)) -join '|')
        $problems | Should -Match 'ruleId is required'
        $problems | Should -Match 'resource is required'
    }

    It 'rejects an unknown tool, a malformed date, a future date and an unknown property' {
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -Tool 'nessus') -Today $script:Today)) -join '|') | Should -Match "tool 'nessus'"
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -Date '15/11/2026') -Today $script:Today)) -join '|') | Should -Match 'date is required as yyyy-MM-dd'
        ($(@(Test-AcceptedRiskEntry -Entry (New-Risk -Date '2026-11-16') -Today $script:Today)) -join '|') | Should -Match 'in the future'
        $typo = New-Risk
        $typo | Add-Member -NotePropertyName 'reasn' -NotePropertyValue 'typo'
        ($(@(Test-AcceptedRiskEntry -Entry $typo -Today $script:Today)) -join '|') | Should -Match "unknown property 'reasn'"
    }

    It 'Read-AcceptedRiskFile lists every problem of every entry in one error' {
        $path = Write-JsonFile -Name 'bad-risks.json' -Content (ConvertTo-Json -Depth 4 -InputObject ([pscustomobject]@{
                    schemaVersion = 1
                    risks         = @((New-Risk -Reason ''), (New-Risk -RuleId '*'), (New-Risk -Tool 'checkov' -RuleId 'CKV_AZURE_1' -Resource 'ok'))
                }))
        $message = Get-ThrownMessage -Script { Read-AcceptedRiskFile -Path $path -Today $script:Today }
        $message | Should -Match 'risks\[0\]: reason is required'
        $message | Should -Match 'risks\[1\]: ruleId must not contain a wildcard'
        $message | Should -Not -Match 'risks\[2\]'
    }

    It 'Read-AcceptedRiskFile rejects a duplicate tool + ruleId + resource' {
        $path = Write-JsonFile -Name 'dup-risks.json' -Content (ConvertTo-Json -Depth 4 -InputObject ([pscustomobject]@{ schemaVersion = 1; risks = @((New-Risk), (New-Risk)) }))
        (Get-ThrownMessage -Script { Read-AcceptedRiskFile -Path $path -Today $script:Today }) | Should -Match 'duplicate of risks\[0\]'
    }

    It 'Read-AcceptedRiskFile rejects a file without the risks array or with the wrong schema version' {
        $noRisks = Write-JsonFile -Name 'no-risks.json' -Content '{ "schemaVersion": 1 }'
        (Get-ThrownMessage -Script { Read-AcceptedRiskFile -Path $noRisks -Today $script:Today }) | Should -Match '"risks"'
        $wrongSchema = Write-JsonFile -Name 'schema2.json' -Content '{ "schemaVersion": 2, "risks": [] }'
        (Get-ThrownMessage -Script { Read-AcceptedRiskFile -Path $wrongSchema -Today $script:Today }) | Should -Match 'schemaVersion must be 1'
    }

    It 'Read-AcceptedRiskFile accepts an empty list and a valid entry' {
        $path = Write-JsonFile -Name 'ok-risks.json' -Content (ConvertTo-Json -Depth 4 -InputObject ([pscustomobject]@{ schemaVersion = 1; risks = @((New-Risk)) }))
        @(Read-AcceptedRiskFile -Path $path -Today $script:Today).Count | Should -Be 1
        $empty = Write-JsonFile -Name 'empty-risks.json' -Content '{ "schemaVersion": 1, "risks": [] }'
        @(Read-AcceptedRiskFile -Path $empty -Today $script:Today).Count | Should -Be 0
    }

    Context 'Resolve-Finding' {
        BeforeAll {
            $script:F1 = New-Finding -Tool 'psrule' -RuleId 'Azure.ContainerApp.MinReplicas' -Resource 'Microsoft.App/containerApps/api' -Severity 'Error' -Message 'm'
            $script:F2 = New-Finding -Tool 'psrule' -RuleId 'Azure.ContainerApp.MinReplicas' -Resource 'Microsoft.App/containerApps/web' -Severity 'Error' -Message 'm'
            $script:F3 = New-Finding -Tool 'psrule' -RuleId 'Azure.Log.Replication' -Resource 'Microsoft.App/containerApps/api' -Severity 'Error' -Message 'm'
        }

        It 'accepts only the exact rule id AND resource' {
            $resolved = Resolve-Finding -Finding @($script:F1, $script:F2, $script:F3) -Risk @((New-Risk)) -Tool 'psrule'
            $resolved.Accepted.Count | Should -Be 1
            $resolved.Accepted[0].Resource | Should -Be 'Microsoft.App/containerApps/api'
            $resolved.Open.Count | Should -Be 2
        }

        It 'does not apply an entry of another tool' {
            $resolved = Resolve-Finding -Finding @($script:F1) -Risk @((New-Risk -Tool 'checkov')) -Tool 'psrule'
            $resolved.Open.Count | Should -Be 1
        }

        It 'matches case-sensitively' {
            $resolved = Resolve-Finding -Finding @($script:F1) -Risk @((New-Risk -RuleId 'azure.containerapp.minreplicas')) -Tool 'psrule'
            $resolved.Open.Count | Should -Be 1
        }

        It 'reports an entry that matches nothing as stale' {
            $resolved = Resolve-Finding -Finding @($script:F3) -Risk @((New-Risk)) -Tool 'psrule'
            $resolved.Stale.Count | Should -Be 1
            $resolved.Open.Count | Should -Be 1
        }

        It 'returns everything as open when there is no risk' {
            (Resolve-Finding -Finding @($script:F1, $script:F2) -Risk @() -Tool 'psrule').Open.Count | Should -Be 2
        }
    }

    Context 'Complete-FindingStep' {
        BeforeAll {
            $script:StepContext = [pscustomobject]@{ OutputDir = $script:Temp; Risk = @((New-Risk)) }
        }

        It 'FAILS on an open finding' {
            $f = New-Finding -Tool 'psrule' -RuleId 'Azure.Other.Rule' -Resource 'x' -Severity 'Error'
            $result = Complete-FindingStep -Context $script:StepContext -Step 'psrule' -Finding @($f)
            $result.Status | Should -Be 'FAIL'
            $result.Detail | Should -Match '1 open, 0 accepted'
        }

        It 'PASSES when every finding is accepted' {
            $f = New-Finding -Tool 'psrule' -RuleId 'Azure.ContainerApp.MinReplicas' -Resource 'Microsoft.App/containerApps/api' -Severity 'Error'
            $result = Complete-FindingStep -Context $script:StepContext -Step 'psrule' -Finding @($f)
            $result.Status | Should -Be 'PASS'
            $result.Detail | Should -Match '0 open, 1 accepted'
        }

        It 'FAILS on a problem (tool error, nothing analysed) even with no finding' {
            $result = Complete-FindingStep -Context $script:StepContext -Step 'psrule' -Finding @() -Problem @('nothing was analysed')
            $result.Status | Should -Be 'FAIL'
            $result.Note | Should -Contain 'nothing was analysed'
        }

        It 'PASSES with no finding and no problem' {
            (Complete-FindingStep -Context $script:StepContext -Step 'psrule' -Finding @()).Status | Should -Be 'PASS'
        }
    }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'exit code and step selection' {
    BeforeAll {
        function New-R { param([string]$Status) return (New-StepResult -Step 's' -Status $Status) }
    }

    It 'is 0 when every step passes' { Get-ValidationExitCode -Result @((New-R 'PASS'), (New-R 'PASS')) | Should -Be 0 }
    It 'is 0 when steps are skipped' { Get-ValidationExitCode -Result @((New-R 'PASS'), (New-R 'SKIP')) | Should -Be 0 }
    It 'is 1 when any step fails' { Get-ValidationExitCode -Result @((New-R 'PASS'), (New-R 'FAIL'), (New-R 'SKIP')) | Should -Be 1 }
    It 'is 0 for no result' { Get-ValidationExitCode -Result @() | Should -Be 0 }
    It 'is 0 when a step only warns (report-only image scan)' { Get-ValidationExitCode -Result @((New-R 'PASS'), (New-R 'WARN'), (New-R 'SKIP')) | Should -Be 0 }
    It 'is still 1 when a step fails next to a warning' { Get-ValidationExitCode -Result @((New-R 'WARN'), (New-R 'FAIL')) | Should -Be 1 }

    It 'formats a WARN line and rejects a status outside PASS, FAIL, SKIP and WARN' {
        (Format-ResultLine -Result (New-StepResult -Step 'trivy-image' -Status WARN -Detail 'api 1 HIGH')) | Should -Match '^WARN trivy-image\s+api 1 HIGH$'
        { New-StepResult -Step 'x' -Status 'MAYBE' } | Should -Throw
    }

    It 'Get-TrivyReportDetail counts HIGH and CRITICAL per image and names the report file' {
        $findings = @(
            (New-Finding -Tool 'trivy-image' -RuleId 'CVE-1' -Resource 'stellar-blaze-api:i1:zlib1g' -Severity 'HIGH')
            (New-Finding -Tool 'trivy-image' -RuleId 'CVE-2' -Resource 'stellar-blaze-api:i1:certifi' -Severity 'CRITICAL')
            (New-Finding -Tool 'trivy-image' -RuleId 'CVE-3' -Resource 'stellar-blaze-api:i1:urllib3' -Severity 'HIGH')
            (New-Finding -Tool 'trivy-image' -RuleId 'CVE-1' -Resource 'stellar-blaze-web:i1:zlib1g' -Severity 'HIGH')
        )
        $detail = Get-TrivyReportDetail -Finding $findings -Image @('stellar-blaze-api:i1', 'stellar-blaze-web:i1') -ReportPath 'C:\out\trivy-image-findings.json'
        $detail | Should -Be 'api 2 HIGH + 1 CRITICAL; web 1 HIGH + 0 CRITICAL (report only, see C:\out\trivy-image-findings.json)'
        (Get-TrivyReportDetail -Finding @() -Image @('stellar-blaze-api:i1') -ReportPath 'f') | Should -Be 'api 0 HIGH + 0 CRITICAL (report only, see f)'
    }

    It 'New-ValidationContext defaults to report-only images and carries -StrictImages' {
        $base = @{ RepoRoot = 'r'; ToolsDir = 't'; OutputDir = 'o'; Lock = [pscustomobject]@{} }
        (New-ValidationContext @base).StrictImages | Should -BeFalse
        (New-ValidationContext @base -StrictImages $true).StrictImages | Should -BeTrue
    }

    It 'formats PASS, FAIL and SKIP lines as status, step, detail' {
        (Format-ResultLine -Result (New-StepResult -Step 'bicep' -Status PASS -Detail 'ok')) | Should -Match '^PASS bicep\s+ok$'
        (Format-ResultLine -Result (New-StepResult -Step 'act' -Status SKIP -Detail 'no job')) | Should -Match '^SKIP act\s+no job$'
        (Format-ResultLine -Result (New-StepResult -Step 'trivy-image' -Status FAIL -Detail '3 open')) | Should -Match '^FAIL trivy-image\s+3 open$'
    }

    It 'runs every step in the fixed order by default' {
        (Resolve-StepSelection) -join ',' | Should -Be 'bicep,psrule,checkov,actionlint,act,hadolint,trivy-image,shellcheck,psscriptanalyzer,script-tests,rehearsal'
    }

    It 'narrows with -Only (array or one comma separated string) and removes with -Skip' {
        (Resolve-StepSelection -Only @('psrule', 'bicep')) -join ',' | Should -Be 'bicep,psrule'
        (Resolve-StepSelection -Only 'bicep, psrule') -join ',' | Should -Be 'bicep,psrule'
        (Resolve-StepSelection -Skip 'trivy-image,checkov,rehearsal') -join ',' | Should -Be 'bicep,psrule,actionlint,act,hadolint,shellcheck,psscriptanalyzer,script-tests'
        (Resolve-StepSelection -Only 'bicep,psrule' -Skip 'psrule') -join ',' | Should -Be 'bicep'
    }

    It 'rejects an unknown step name' {
        { Resolve-StepSelection -Only 'bicpe' } | Should -Throw '*Unknown step*'
        { Resolve-StepSelection -Skip 'nope' } | Should -Throw '*Unknown step*'
    }

    Context 'Invoke-ValidationStep error mapping' {
        BeforeAll { $script:StepContext = [pscustomobject]@{ OutputDir = $script:Temp } }

        It 'passes a step result through and records the time' {
            Mock Invoke-StepBicep { New-StepResult -Step 'bicep' -Status PASS -Detail 'fine' }
            $result = Invoke-ValidationStep -Context $script:StepContext -Step 'bicep'
            $result.Status | Should -Be 'PASS'
            $result.Seconds | Should -BeGreaterOrEqual 0
        }

        It 'turns an Unavailable error into SKIP with the reason' {
            Mock Invoke-StepBicep { Stop-Step -Kind Unavailable -Message 'the Docker daemon is not running' }
            $result = Invoke-ValidationStep -Context $script:StepContext -Step 'bicep'
            $result.Status | Should -Be 'SKIP'
            $result.Detail | Should -Be 'the Docker daemon is not running'
        }

        It 'turns an Integrity error into FAIL' {
            Mock Invoke-StepBicep { Stop-Step -Kind Integrity -Message 'SHA256 mismatch' }
            $result = Invoke-ValidationStep -Context $script:StepContext -Step 'bicep'
            $result.Status | Should -Be 'FAIL'
            $result.Detail | Should -Match 'integrity check failed'
        }

        It 'turns any other error into FAIL, never into SKIP' {
            Mock Invoke-StepBicep { throw 'boom' }
            $result = Invoke-ValidationStep -Context $script:StepContext -Step 'bicep'
            $result.Status | Should -Be 'FAIL'
            $result.Detail | Should -Match 'unexpected error: boom'
        }
    }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'tool output parsers' {
    It 'bicep: keeps Warning and Error, drops Info, de-duplicates, and makes the path repo-relative' {
        $root = 'D:\dev\stellar-blaze-i1'
        $text = @(
            'D:\dev\stellar-blaze-i1\infra\bicep\modules\environment.bicep(39,64) : Warning use-recent-api-versions: Use more recent API version. [https://aka.ms/x]'
            'D:\dev\stellar-blaze-i1\infra\bicep\modules\environment.bicep(39,64) : Warning use-recent-api-versions: Use more recent API version. [https://aka.ms/x]'
            'D:\dev\stellar-blaze-i1\infra\bicep\main.bicep(5,1) : Error BCP033: Expected a value of type "string".'
            'D:\dev\stellar-blaze-i1\infra\bicep\main.bicep(9,1) : Info no-unused-vars: Variable "x" is declared but never used.'
            'not a diagnostic line'
        ) -join "`r`n"
        $found = @(ConvertFrom-BicepDiagnosticText -Text $text -RepoRoot $root)
        $found.Count | Should -Be 2
        $found[0].RuleId | Should -Be 'use-recent-api-versions'
        $found[0].Resource | Should -Be 'infra/bicep/modules/environment.bicep'
        $found[1].Severity | Should -Be 'Error'
    }

    It 'psrule: only Fail and Error outcomes become findings; the resource is type/name' {
        $document = ConvertFrom-Json -InputObject '{"results":[{"ruleName":"Azure.Log.Replication","outcome":"Fail","targetName":"log-x","targetType":"Microsoft.OperationalInsights/workspaces","level":"Error","ref":"AZR-000425","reason":["Path properties.replication.enabled: missing"]},{"ruleName":"Azure.Log.Name","outcome":"Pass","targetName":"log-x","targetType":"Microsoft.OperationalInsights/workspaces","level":"Error","ref":"AZR-1","reason":[]}]}'
        $found = @(ConvertFrom-PSRuleResult -Document $document)
        $found.Count | Should -Be 1
        $found[0].RuleId | Should -Be 'Azure.Log.Replication'
        $found[0].Resource | Should -Be 'Microsoft.OperationalInsights/workspaces/log-x'
        $found[0].Message | Should -Match 'AZR-000425'
    }

    It 'checkov: reads an object or an array of objects, strips the mount prefix and keys the resource by file' {
        $one = '{"check_type":"arm","results":{"failed_checks":[{"check_id":"CKV_AZURE_163","check_name":"Enable scanning","resource":"Microsoft.ContainerRegistry/registries.x","file_path":"/tf/bootstrap.json","file_line_range":[73,266],"severity":null}]},"summary":{"passed":3,"failed":1,"parsing_errors":0}}'
        $found = @(ConvertFrom-CheckovJson -Text $one)
        $found.Count | Should -Be 1
        $found[0].RuleId | Should -Be 'CKV_AZURE_163'
        $found[0].Resource | Should -Be 'bootstrap.json#Microsoft.ContainerRegistry/registries.x'
        @(ConvertFrom-CheckovJson -Text ('[' + $one + ',' + $one + ']')).Count | Should -Be 2
        $summary = Get-CheckovSummary -Text ('[' + $one + ',' + $one + ']')
        $summary.Passed | Should -Be 6
        $summary.Failed | Should -Be 2
        $summary.ParsingErrors | Should -Be 0
        (Get-CheckovSummary -Text '{"summary":{"passed":0,"failed":0,"parsing_errors":4}}').ParsingErrors | Should -Be 4
    }

    It 'actionlint: one finding per error, kind as the rule id' {
        $found = @(ConvertFrom-ActionlintJson -RepoRoot 'D:\repo' -Text '[{"message":"property x is not defined","filepath":"D:\\repo\\.github\\workflows\\ci.yml","line":12,"column":3,"kind":"expression"}]')
        $found.Count | Should -Be 1
        $found[0].RuleId | Should -Be 'expression'
        $found[0].Resource | Should -Be '.github/workflows/ci.yml'
        @(ConvertFrom-ActionlintJson -RepoRoot 'D:\repo' -Text 'null').Count | Should -Be 0
        @(ConvertFrom-ActionlintJson -RepoRoot 'D:\repo' -Text '[]').Count | Should -Be 0
    }

    It 'hadolint: drops the style level and keeps the rest (one item or many)' {
        $text = '[{"code":"DL3008","column":1,"file":"backend/Dockerfile","level":"warning","line":14,"message":"Pin versions"},{"code":"DL3059","column":1,"file":"backend/Dockerfile","level":"style","line":20,"message":"Multiple RUN"}]'
        $found = @(ConvertFrom-HadolintJson -Text $text -RepoRoot 'D:\repo')
        $found.Count | Should -Be 1
        $found[0].RuleId | Should -Be 'DL3008'
        $found[0].Resource | Should -Be 'backend/Dockerfile'
        @(ConvertFrom-HadolintJson -Text '[{"code":"DL3002","file":"frontend/Dockerfile","level":"error","line":3,"message":"root"}]' -RepoRoot 'D:\repo').Count | Should -Be 1
    }

    It 'shellcheck: json1 comments become SC-number findings' {
        $found = @(ConvertFrom-ShellcheckJson -RepoRoot 'D:\repo' -Text '{"comments":[{"file":"infra/scripts/lib.sh","line":7,"column":1,"level":"warning","code":2086,"message":"Double quote"}]}')
        $found.Count | Should -Be 1
        $found[0].RuleId | Should -Be 'SC2086'
        @(ConvertFrom-ShellcheckJson -RepoRoot 'D:\repo' -Text '{"comments":[]}').Count | Should -Be 0
    }

    It 'psscriptanalyzer: rule, file and line' {
        $found = @(ConvertFrom-AnalyzerJson -RepoRoot 'D:\repo' -Text '[{"RuleName":"PSAvoidUsingWriteHost","Severity":"Warning","ScriptPath":"D:\\repo\\infra\\scripts\\x.ps1","Line":4,"Message":"no"}]')
        $found.Count | Should -Be 1
        $found[0].Resource | Should -Be 'infra/scripts/x.ps1'
    }

    It 'trivy: keeps HIGH and CRITICAL, one finding per CVE and package, notes when there is no fix' {
        $text = '{"Results":[{"Target":"os","Vulnerabilities":[{"VulnerabilityID":"CVE-1","PkgName":"zlib","InstalledVersion":"1","FixedVersion":"2","Severity":"HIGH","Title":"t"},{"VulnerabilityID":"CVE-1","PkgName":"zlib","InstalledVersion":"1","FixedVersion":"2","Severity":"HIGH","Title":"t"},{"VulnerabilityID":"CVE-2","PkgName":"libx","InstalledVersion":"1","Severity":"CRITICAL","Title":"u"},{"VulnerabilityID":"CVE-3","PkgName":"liby","InstalledVersion":"1","Severity":"MEDIUM","Title":"v"}]}]}'
        $found = @(ConvertFrom-TrivyJson -Text $text -Image 'img:i1')
        $found.Count | Should -Be 2
        $found[0].Resource | Should -Be 'img:i1:zlib'
        $found[1].Message | Should -Match 'no fix published'
        @(ConvertFrom-TrivyJson -Text '{"Results":[{"Target":"os"}]}' -Image 'img:i1').Count | Should -Be 0
    }
}

# ---------------------------------------------------------------------------------------------------------------------
Describe 'native commands and helpers' {
    It 'quotes arguments the way CommandLineToArgvW reads them' -ForEach @(
        @{ Arguments = @('a', 'b'); Expected = 'a b' }
        @{ Arguments = @('with space'); Expected = '"with space"' }
        @{ Arguments = @(''); Expected = '""' }
        @{ Arguments = @('say "hi"'); Expected = '"say \"hi\""' }
        @{ Arguments = @('C:\dir with space\'); Expected = '"C:\dir with space\\"' }
        @{ Arguments = @('{{json .}}'); Expected = '"{{json .}}"' }
        @{ Arguments = @('--format=json1'); Expected = '--format=json1' }
    ) {
        ConvertTo-ArgumentString -Argument $Arguments | Should -Be $Expected
    }

    It 'Invoke-Native keeps stdout and stderr apart and returns the exit code' -Skip:(-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
        $result = Invoke-Native -FilePath 'cmd.exe' -Argument @('/c', 'echo out& echo err 1>&2& exit 3')
        $result.ExitCode | Should -Be 3
        $result.StdOut.Trim() | Should -Be 'out'
        $result.StdErr.Trim() | Should -Be 'err'
    }

    It 'Invoke-Native passes environment variables to the child only and writes the logs' -Skip:(-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
        $prefix = Join-Path -Path $script:Temp -ChildPath 'native'
        $result = Invoke-Native -FilePath 'cmd.exe' -Argument @('/c', 'echo %VALIDATE_LOCAL_TEST%') -Environment @{ VALIDATE_LOCAL_TEST = 'from-child' } -LogPrefix $prefix
        $result.StdOut.Trim() | Should -Be 'from-child'
        (Test-Path Env:\VALIDATE_LOCAL_TEST) | Should -BeFalse
        [System.IO.File]::ReadAllText($prefix + '.stdout.log').Trim() | Should -Be 'from-child'
        Test-Path -LiteralPath ($prefix + '.stderr.log') | Should -BeTrue
    }

    It 'Invoke-Native does not put the arguments into its error when the program cannot start' {
        $message = Get-ThrownMessage -Script { Invoke-Native -FilePath (Join-Path -Path $script:Temp -ChildPath 'no-such-program.exe') -Argument @('--token', 'SECRET-VALUE-123') }
        $message | Should -Match 'Cannot start'
        $message | Should -Not -Match 'SECRET-VALUE-123'
    }

    It 'Get-DummyParameterEnvironment supplies every variable the parameter files read without a default' {
        $dummy = Get-DummyParameterEnvironment
        $required = New-Object System.Collections.Generic.List[string]
        foreach ($file in @('main.bicepparam', 'bootstrap.bicepparam')) {
            foreach ($line in [System.IO.File]::ReadAllLines((Join-Path -Path $script:RepoDir -ChildPath ('infra\bicep\' + $file)))) {
                if ($line -match "readEnvironmentVariable\('(?<name>[A-Z0-9_]+)'\)") { $required.Add($Matches['name']) }
            }
        }
        $required.Count | Should -BeGreaterThan 10
        foreach ($name in $required) { $dummy.Keys | Should -Contain $name }
        $dummy['PG_ADMIN_PASSWORD'] | Should -Match '^[0-9a-f]{64}$'
        $dummy['ACR_NAME'] | Should -Be 'acrsbdummy'
        { ConvertFrom-Json -InputObject $dummy['SB_ACCESS_TOKENS'] } | Should -Not -Throw
        (Get-DummyParameterEnvironment)['PG_ADMIN_PASSWORD'] | Should -Not -Be $dummy['PG_ADMIN_PASSWORD']
    }

    It 'Test-WorkflowHasJob finds a top-level job and nothing else' {
        $path = Write-JsonFile -Name 'ci.yml' -Content "name: ci`njobs:`n  backend:`n    runs-on: x`n    steps:`n      - run: echo infra:`n  infra:`n    runs-on: y`n"
        Test-WorkflowHasJob -WorkflowPath $path -Job 'infra' | Should -BeTrue
        Test-WorkflowHasJob -WorkflowPath $path -Job 'frontend' | Should -BeFalse
        $without = Write-JsonFile -Name 'ci2.yml' -Content "name: ci`njobs:`n  backend:`n    steps:`n      - run: echo infra:`n"
        Test-WorkflowHasJob -WorkflowPath $without -Job 'infra' | Should -BeFalse
        Test-WorkflowHasJob -WorkflowPath (Join-Path -Path $script:Temp -ChildPath 'absent.yml') -Job 'infra' | Should -BeFalse
    }

    It 'ConvertTo-RepoRelativePath handles both slash styles and paths outside the repo' {
        ConvertTo-RepoRelativePath -Path 'D:\repo\infra\a.sh' -RepoRoot 'D:\repo' | Should -Be 'infra/a.sh'
        ConvertTo-RepoRelativePath -Path 'd:/repo/infra/a.sh' -RepoRoot 'D:\repo\' | Should -Be 'infra/a.sh'
        ConvertTo-RepoRelativePath -Path 'E:\elsewhere\a.sh' -RepoRoot 'D:\repo' | Should -Be 'E:/elsewhere/a.sh'
    }
}
