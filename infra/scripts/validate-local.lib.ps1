[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Operator-script steps that install pinned tools into a tools directory; -WhatIf would not be honoured by the downloads and native calls they wrap.')]
param()

# validate-local.lib.ps1 - all logic of infra/scripts/validate-local.ps1, as functions.
#
# Dot-sourced by the entry script and by the Pester tests (infra/scripts/tests/ps/ValidateLocal.Tests.ps1).
# Nothing here needs Azure or any account. It downloads pinned tools (infra/validate/tools.lock.json) from their official
# release pages into a tools directory OUTSIDE the repository, verifies every download against the lock and fails closed.
#
# Runs on Windows PowerShell 5.1 and PowerShell 7: no `&&`, `||`, `??`, ternary, `?.`, `-AsHashtable`, `Get-Date -AsUTC`.
#
# Rules this file follows:
#   - every native call goes through Invoke-Native: stdout and stderr are captured separately by System.Diagnostics.Process
#     (never `2>&1`, never `2>file`: Windows PowerShell 5.1 turns redirected native stderr into error records), the exit
#     code is checked by the caller, and the full output is kept in the output directory;
#   - a finding either fails its step or is listed in infra/validate/accepted-risks.json: one entry per tool, rule id AND
#     resource, with a written reason and a date; a wildcard is rejected; there is no blanket suppression;
#   - a download is accepted only from an allow-listed https host and only when its hash equals the lock's hash.

$script:LibDir = $PSScriptRoot

$script:StepNames = @('bicep', 'psrule', 'checkov', 'actionlint', 'act', 'hadolint', 'trivy-image', 'shellcheck', 'psscriptanalyzer', 'script-tests', 'rehearsal')
# Steps whose result is a list of findings (the others report an exit code only), so accepted risks can name them.
$script:FindingSteps = @('bicep', 'psrule', 'checkov', 'actionlint', 'hadolint', 'trivy-image', 'shellcheck', 'psscriptanalyzer')
$script:AllowedDownloadHosts = @('github.com', 'www.powershellgallery.com')
$script:DefaultTrivyImages = @('stellar-blaze-api:i1', 'stellar-blaze-web:i1')
$script:MaxFindingsPrinted = 25

# ---------------------------------------------------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------------------------------------------------

function Write-Say {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text = '')
    Write-Information -MessageData $Text -InformationAction Continue
}

function Stop-Step {
    <# Throws an error carrying a Kind: 'Integrity' (a checksum or lock mismatch: the step FAILS) or 'Unavailable' (the tool
       cannot be installed or run here: the step is SKIPPED with the reason). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('Integrity', 'Unavailable')][string]$Kind,
        [Parameter(Mandatory)][string]$Message
    )
    $exception = New-Object System.Exception -ArgumentList $Message
    $exception.Data['Kind'] = $Kind
    throw $exception
}

function Get-ErrorKind {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$ErrorRecord)
    $exception = $ErrorRecord.Exception
    if ($null -ne $exception -and $exception.Data.Contains('Kind')) { return [string]$exception.Data['Kind'] }
    return ''
}

# ---------------------------------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------------------------------

function Get-PropertyValue {
    <# Safe under strict mode: the property's value, or $Default when the object has no such property. #>
    [CmdletBinding()]
    param($InputObject, [Parameter(Mandatory)][string]$Name, $Default = $null)
    if ($null -eq $InputObject) { return $Default }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Get-JsonItem {
    <# ConvertFrom-Json flattened to a plain array (5.1 returns a top-level JSON array as ONE object, 7 unrolls it). #>
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $parsed = ConvertFrom-Json -InputObject $Text
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($candidate in @($parsed)) {
        if ($candidate -is [System.Array]) { foreach ($inner in $candidate) { $items.Add($inner) } }
        elseif ($null -ne $candidate) { $items.Add($candidate) }
    }
    return $items.ToArray()
}

function ConvertTo-RepoRelativePath {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Path, [Parameter(Mandatory)][string]$RepoRoot)
    if ([string]::IsNullOrEmpty($Path)) { return '' }
    $normalized = $Path.Replace('\', '/')
    $root = $RepoRoot.Replace('\', '/').TrimEnd('/') + '/'
    if ($normalized.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { return $normalized.Substring($root.Length) }
    return $normalized
}

function ConvertTo-ArgumentString {
    <# Windows command-line quoting (CommandLineToArgvW rules) for System.Diagnostics.ProcessStartInfo.Arguments, which
       Windows PowerShell 5.1 (.NET Framework) offers instead of an ArgumentList. #>
    [CmdletBinding()]
    param([string[]]$Argument = @())
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($item in $Argument) {
        if ($null -eq $item -or $item.Length -eq 0) { $parts.Add('""'); continue }
        if ($item -notmatch '[\s"]') { $parts.Add($item); continue }
        $builder = New-Object System.Text.StringBuilder
        [void]$builder.Append('"')
        $backslashes = 0
        foreach ($character in $item.ToCharArray()) {
            if ($character -eq '\') { $backslashes++; continue }
            if ($character -eq '"') {
                [void]$builder.Append('\', ($backslashes * 2 + 1))
                [void]$builder.Append('"')
            }
            else {
                if ($backslashes -gt 0) { [void]$builder.Append('\', $backslashes) }
                [void]$builder.Append($character)
            }
            $backslashes = 0
        }
        if ($backslashes -gt 0) { [void]$builder.Append('\', ($backslashes * 2)) }
        [void]$builder.Append('"')
        $parts.Add($builder.ToString())
    }
    return ($parts -join ' ')
}

function Invoke-Native {
    <#
    .SYNOPSIS
        Runs a native command; returns ExitCode, StdOut, StdErr (and the log paths). Never throws on a non-zero exit code.
    .DESCRIPTION
        stdout and stderr are read separately by System.Diagnostics.Process, so nothing is merged and no PowerShell
        error record is created for native stderr. -LogPrefix writes <prefix>.stdout.log and <prefix>.stderr.log. -Environment
        adds process environment variables for this child only. Arguments are never put into an error message.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Argument = @(),
        [string]$WorkingDirectory = '',
        [hashtable]$Environment = @{},
        [string]$LogPrefix = '',
        [int]$TimeoutSeconds = 1800
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = ConvertTo-ArgumentString -Argument $Argument
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
    foreach ($key in $Environment.Keys) { $startInfo.EnvironmentVariables[[string]$key] = [string]$Environment[$key] }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try { [void]$process.Start() }
    catch { throw ('Cannot start {0}: {1}' -f (Split-Path -Path $FilePath -Leaf), $_.Exception.Message) }
    $process.StandardInput.Close()   # nothing is ever typed into a tool: a prompt must fail, not hang
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill() } catch { Write-Verbose -Message ('Kill failed: ' + $_.Exception.Message) }
        throw ('{0} did not finish within {1} seconds and was stopped.' -f (Split-Path -Path $FilePath -Leaf), $TimeoutSeconds)
    }
    $process.WaitForExit()
    $result = [pscustomobject]@{
        ExitCode      = $process.ExitCode
        StdOut        = $outTask.Result
        StdErr        = $errTask.Result
        StdOutPath    = ''
        StdErrPath    = ''
    }
    if ($LogPrefix) {
        $result.StdOutPath = $LogPrefix + '.stdout.log'
        $result.StdErrPath = $LogPrefix + '.stderr.log'
        [System.IO.File]::WriteAllText($result.StdOutPath, $result.StdOut)
        [System.IO.File]::WriteAllText($result.StdErrPath, $result.StdErr)
    }
    $process.Dispose()
    return $result
}

function Get-TextTail {
    [CmdletBinding()]
    param([AllowEmptyString()][AllowNull()][string]$Text, [int]$Lines = 3)
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    $all = @(($Text -replace "`r", '') -split "`n" | Where-Object { $_.Trim().Length -gt 0 })
    return (($all | Select-Object -Last $Lines) -join ' | ')
}

function Test-CommandAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Name)
    return ($null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue))
}

function Get-HostExecutable {
    <# The PowerShell that runs this script, so child scripts run on the same edition. #>
    [CmdletBinding()]
    param()
    return [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
}

# ---------------------------------------------------------------------------------------------------------------------
# The lock file
# ---------------------------------------------------------------------------------------------------------------------

function Test-AllowedDownloadUrl {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Url)
    $uri = $null
    if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$uri)) { return $false }
    if ($uri.Scheme -ne 'https') { return $false }
    return ($script:AllowedDownloadHosts -contains $uri.Host.ToLowerInvariant())
}

function Test-ToolLockObject {
    <# Returns a list of problems (empty when the lock is well formed). Pure: no file, no network. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Lock)
    $problems = New-Object System.Collections.Generic.List[string]
    if ((Get-PropertyValue -InputObject $Lock -Name 'schemaVersion') -ne 1) { $problems.Add('schemaVersion must be 1.') }
    $hex64 = '^[0-9a-fA-F]{64}$'
    $binaries = Get-PropertyValue -InputObject $Lock -Name 'binaries'
    if ($null -eq $binaries) { $problems.Add('"binaries" is missing.') }
    else {
        foreach ($property in $binaries.PSObject.Properties) {
            $name = $property.Name
            $entry = $property.Value
            foreach ($field in @('version', 'url', 'kind', 'sha256', 'exe', 'exeSha256')) {
                if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue -InputObject $entry -Name $field))) { $problems.Add("binaries.$name.$field is missing.") }
            }
            if ((Get-PropertyValue -InputObject $entry -Name 'kind') -notin @('exe', 'zip')) { $problems.Add("binaries.$name.kind must be exe or zip.") }
            if ([string](Get-PropertyValue -InputObject $entry -Name 'sha256' -Default '') -notmatch $hex64) { $problems.Add("binaries.$name.sha256 must be 64 hex characters.") }
            if ([string](Get-PropertyValue -InputObject $entry -Name 'exeSha256' -Default '') -notmatch $hex64) { $problems.Add("binaries.$name.exeSha256 must be 64 hex characters.") }
            if (-not (Test-AllowedDownloadUrl -Url ([string](Get-PropertyValue -InputObject $entry -Name 'url' -Default '')))) { $problems.Add("binaries.$name.url must be https on an allow-listed host ($($script:AllowedDownloadHosts -join ', ')).") }
        }
    }
    $modules = Get-PropertyValue -InputObject $Lock -Name 'psModules'
    if ($null -eq $modules) { $problems.Add('"psModules" is missing.') }
    else {
        foreach ($property in $modules.PSObject.Properties) {
            $name = $property.Name
            $entry = $property.Value
            if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue -InputObject $entry -Name 'version'))) { $problems.Add("psModules.$name.version is missing.") }
            if ([string](Get-PropertyValue -InputObject $entry -Name 'sha512' -Default '') -notmatch '^[A-Za-z0-9+/]{86}==$') { $problems.Add("psModules.$name.sha512 must be a base64 SHA512 (the PowerShell Gallery PackageHash).") }
            if (-not (Test-AllowedDownloadUrl -Url ([string](Get-PropertyValue -InputObject $entry -Name 'url' -Default '')))) { $problems.Add("psModules.$name.url must be https on an allow-listed host.") }
        }
    }
    $images = Get-PropertyValue -InputObject $Lock -Name 'images'
    if ($null -eq $images) { $problems.Add('"images" is missing.') }
    else {
        foreach ($property in $images.PSObject.Properties) {
            $name = $property.Name
            $entry = $property.Value
            if ([string](Get-PropertyValue -InputObject $entry -Name 'digest' -Default '') -notmatch '^sha256:[0-9a-f]{64}$') { $problems.Add("images.$name.digest must be sha256:<64 hex>.") }
            if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue -InputObject $entry -Name 'repository'))) { $problems.Add("images.$name.repository is missing.") }
        }
    }
    return $problems.ToArray()
}

function Read-ToolLock {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Lock file not found: $Path" }
    $lock = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Path))
    $problems = @(Test-ToolLockObject -Lock $lock)
    if ($problems.Count -gt 0) { throw ("Invalid tools.lock.json:`n  " + ($problems -join "`n  ")) }
    return $lock
}

# ---------------------------------------------------------------------------------------------------------------------
# Hashes, download, extraction
# ---------------------------------------------------------------------------------------------------------------------

function Get-FileDigest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('SHA256', 'SHA512')][string]$Algorithm
    )
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hasher = [System.Security.Cryptography.HashAlgorithm]::Create($Algorithm)
        try { $bytes = $hasher.ComputeHash($stream) }
        finally { $hasher.Dispose() }
    }
    finally { $stream.Dispose() }
    if ($Algorithm -eq 'SHA256') { return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '') }
    return [Convert]::ToBase64String($bytes)
}

function Assert-FileDigest {
    <# Throws an Integrity error unless the file's digest equals the expected one. sha256: hex, case-insensitive;
       sha512: base64 (the PowerShell Gallery PackageHash), case-sensitive. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('SHA256', 'SHA512')][string]$Algorithm,
        [Parameter(Mandatory)][string]$Expected,
        [string]$Label = ''
    )
    if (-not $Label) { $Label = Split-Path -Path $Path -Leaf }
    $actual = Get-FileDigest -Path $Path -Algorithm $Algorithm
    $same = $false
    if ($Algorithm -eq 'SHA256') { $same = ($actual -eq $Expected.ToLowerInvariant()) }
    else { $same = ($actual -ceq $Expected) }
    if (-not $same) {
        Stop-Step -Kind Integrity -Message ('{0}: {1} mismatch. Expected {2}, got {3}. The file was refused.' -f $Label, $Algorithm, $Expected, $actual)
    }
}

function Save-VerifiedDownload {
    <# Downloads Url to Destination only when it is on the allow-list and its digest equals the lock's. On a mismatch the
       partial file is deleted and nothing is left at Destination. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][ValidateSet('SHA256', 'SHA512')][string]$Algorithm,
        [Parameter(Mandatory)][string]$Expected,
        [int]$Attempts = 3
    )
    if (-not (Test-AllowedDownloadUrl -Url $Url)) { Stop-Step -Kind Integrity -Message "Refusing to download from a URL that is not https on an allow-listed host ($($script:AllowedDownloadHosts -join ', '))." }
    $directory = Split-Path -Path $Destination -Parent
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    # A file already in the downloads folder is reused only when it passes the same check; anything else is downloaded afresh.
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $cached = $false
        try { Assert-FileDigest -Path $Destination -Algorithm $Algorithm -Expected $Expected -Label (Split-Path -Path $Url -Leaf); $cached = $true }
        catch { Write-Verbose -Message 'The cached download does not match the lock; downloading again.' }
        if ($cached) { return }
    }
    $partial = $Destination + '.partial'
    $previousProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $lastError = ''
        $downloaded = $false
        for ($attempt = 1; $attempt -le $Attempts -and -not $downloaded; $attempt++) {
            try {
                if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
                Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial -ErrorAction Stop
                $downloaded = $true
            }
            catch { $lastError = $_.Exception.Message }
        }
        if (-not $downloaded) { Stop-Step -Kind Unavailable -Message ('Download failed after {0} attempts ({1}): {2}' -f $Attempts, $Url, $lastError) }
        try { Assert-FileDigest -Path $partial -Algorithm $Algorithm -Expected $Expected -Label (Split-Path -Path $Url -Leaf) }
        catch {
            Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
            throw
        }
        if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
        Move-Item -LiteralPath $partial -Destination $Destination
    }
    finally { $ProgressPreference = $previousProgress }
}

function Expand-ZipSafely {
    <# Extracts a zip below Destination; an entry that would land outside it (zip-slip) throws. With -EntryLeaf only the
       entry whose file name equals it is written (flat, into Destination). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ZipPath,
        [Parameter(Mandatory)][string]$Destination,
        [string]$EntryLeaf = ''
    )
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
    $root = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    $found = $false
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if ($EntryLeaf) {
                if ($entry.Name -ne $EntryLeaf) { continue }
                $target = [System.IO.Path]::GetFullPath((Join-Path -Path $Destination -ChildPath $entry.Name))
            }
            else { $target = [System.IO.Path]::GetFullPath((Join-Path -Path $Destination -ChildPath $entry.FullName)) }
            if (-not $target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Zip entry escapes the destination: ' + $entry.FullName) }
            $targetDirectory = Split-Path -Path $target -Parent
            if (-not (Test-Path -LiteralPath $targetDirectory)) { New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
            $found = $true
        }
    }
    finally { $archive.Dispose() }
    if ($EntryLeaf -and -not $found) { throw "Entry $EntryLeaf not found in the archive." }
}

# ---------------------------------------------------------------------------------------------------------------------
# Installing the pinned tools (from the lock only)
# ---------------------------------------------------------------------------------------------------------------------

function Get-ToolBinDirectory { [CmdletBinding()] param([Parameter(Mandatory)]$Context) return (Join-Path -Path $Context.ToolsDir -ChildPath 'bin') }
function Get-ToolModuleDirectory { [CmdletBinding()] param([Parameter(Mandatory)]$Context) return (Join-Path -Path $Context.ToolsDir -ChildPath 'psmodules') }

function Install-LockedTool {
    <# Idempotent. Returns the full path of the pinned executable; installs it (download, verify, extract, verify again)
       when it is missing or its sha256 differs from the lock. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Name)
    $entry = Get-PropertyValue -InputObject $Context.Lock.binaries -Name $Name
    if ($null -eq $entry) { Stop-Step -Kind Integrity -Message "Tool $Name is not in tools.lock.json." }
    $binDir = Get-ToolBinDirectory -Context $Context
    $exePath = Join-Path -Path $binDir -ChildPath $entry.exe
    if ((Test-Path -LiteralPath $exePath -PathType Leaf) -and ((Get-FileDigest -Path $exePath -Algorithm SHA256) -eq $entry.exeSha256.ToLowerInvariant())) { return $exePath }
    if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force }
    if (-not (Test-Path -LiteralPath $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
    $downloads = Join-Path -Path $Context.ToolsDir -ChildPath 'downloads'
    $archivePath = Join-Path -Path $downloads -ChildPath (Split-Path -Path $entry.url -Leaf)
    Write-Say -Text ("  installing {0} {1} from {2}" -f $Name, $entry.version, $entry.url)
    Save-VerifiedDownload -Url $entry.url -Destination $archivePath -Algorithm SHA256 -Expected $entry.sha256
    if ($entry.kind -eq 'zip') {
        $staging = Join-Path -Path $downloads -ChildPath ('extract-' + $Name)
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        Expand-ZipSafely -ZipPath $archivePath -Destination $staging -EntryLeaf $entry.exe
        $extracted = Join-Path -Path $staging -ChildPath $entry.exe
    }
    else { $extracted = $archivePath }
    try { Assert-FileDigest -Path $extracted -Algorithm SHA256 -Expected $entry.exeSha256 -Label $entry.exe }
    catch {
        if ($entry.kind -eq 'zip' -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
        throw
    }
    if ($entry.kind -eq 'zip') {
        Move-Item -LiteralPath $extracted -Destination $exePath -Force
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    else { Copy-Item -LiteralPath $extracted -Destination $exePath -Force }
    return $exePath
}

function Install-LockedPsModule {
    <# Idempotent. Installs the pinned versions of the named PowerShell Gallery modules below <ToolsDir>\psmodules\<Name>\<Version>
       (the nupkg's SHA512 must equal the feed PackageHash in the lock). Returns the psmodules directory. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string[]]$Name)
    $moduleRoot = Get-ToolModuleDirectory -Context $Context
    foreach ($moduleName in $Name) {
        $entry = Get-PropertyValue -InputObject $Context.Lock.psModules -Name $moduleName
        if ($null -eq $entry) { Stop-Step -Kind Integrity -Message "PowerShell module $moduleName is not in tools.lock.json." }
        $target = Join-Path -Path (Join-Path -Path $moduleRoot -ChildPath $moduleName) -ChildPath $entry.version
        $marker = Join-Path -Path $target -ChildPath '.lock-sha512'
        if ((Test-Path -LiteralPath $marker -PathType Leaf) -and (([System.IO.File]::ReadAllText($marker)).Trim() -ceq $entry.sha512)) { continue }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        $downloads = Join-Path -Path $Context.ToolsDir -ChildPath 'downloads'
        $package = Join-Path -Path $downloads -ChildPath ('{0}.{1}.nupkg' -f $moduleName, $entry.version)
        Write-Say -Text ("  installing PowerShell module {0} {1} from {2}" -f $moduleName, $entry.version, $entry.url)
        Save-VerifiedDownload -Url $entry.url -Destination $package -Algorithm SHA512 -Expected $entry.sha512
        $staging = $target + '.staging'
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        Expand-ZipSafely -ZipPath $package -Destination $staging
        foreach ($packaging in @('_rels', 'package', '[Content_Types].xml')) {
            $junk = Join-Path -Path $staging -ChildPath $packaging
            if (Test-Path -LiteralPath $junk) { Remove-Item -LiteralPath $junk -Recurse -Force }
        }
        [System.IO.File]::WriteAllText((Join-Path -Path $staging -ChildPath '.lock-sha512'), $entry.sha512)
        $parent = Split-Path -Path $target -Parent
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Move-Item -LiteralPath $staging -Destination $target
    }
    return $moduleRoot
}

function Test-DockerAvailable {
    [CmdletBinding()]
    param()
    if (-not (Test-CommandAvailable -Name 'docker')) { return 'docker is not installed (or not on PATH)' }
    $probe = Invoke-Native -FilePath 'docker' -Argument @('version', '--format', '{{.Server.Version}}') -TimeoutSeconds 60
    if ($probe.ExitCode -ne 0) { return 'the Docker daemon is not running' }
    return ''
}

function Install-LockedImage {
    <# Pulls <repository>@<digest> (Docker verifies the content against the digest) unless it is already local.
       Returns the reference to run. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Name)
    $entry = Get-PropertyValue -InputObject $Context.Lock.images -Name $Name
    if ($null -eq $entry) { Stop-Step -Kind Integrity -Message "Image $Name is not in tools.lock.json." }
    $unavailable = Test-DockerAvailable
    if ($unavailable) { Stop-Step -Kind Unavailable -Message $unavailable }
    $reference = '{0}@{1}' -f $entry.repository, $entry.digest
    $inspect = Invoke-Native -FilePath 'docker' -Argument @('image', 'inspect', '--format', '{{.Id}}', $reference) -TimeoutSeconds 120
    if ($inspect.ExitCode -eq 0) { return $reference }
    Write-Say -Text ("  pulling {0} (pinned by digest)" -f $reference)
    $pull = Invoke-Native -FilePath 'docker' -Argument @('pull', '--quiet', $reference) -TimeoutSeconds 1800
    if ($pull.ExitCode -ne 0) { Stop-Step -Kind Unavailable -Message ('docker pull failed: ' + (Get-TextTail -Text $pull.StdErr -Lines 2)) }
    return $reference
}

function Get-ChildHostEnvironment {
    <# Environment for a child PowerShell: the pinned modules first on PSModulePath, the pinned bin directory on PATH. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [hashtable]$Extra = @{})
    $environment = @{}
    $environment['PSModulePath'] = (Get-ToolModuleDirectory -Context $Context) + [System.IO.Path]::PathSeparator + $env:PSModulePath
    $environment['PATH'] = (Get-ToolBinDirectory -Context $Context) + [System.IO.Path]::PathSeparator + $env:PATH
    foreach ($key in $Extra.Keys) { $environment[$key] = $Extra[$key] }
    return $environment
}

# ---------------------------------------------------------------------------------------------------------------------
# Findings and accepted risks
# ---------------------------------------------------------------------------------------------------------------------

function New-Finding {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Tool,
        [Parameter(Mandatory)][string]$RuleId,
        [Parameter(Mandatory)][string]$Resource,
        [string]$Severity = '',
        [string]$Message = ''
    )
    return [pscustomobject]@{ Tool = $Tool; RuleId = $RuleId; Resource = $Resource; Severity = $Severity; Message = $Message }
}

function Test-AcceptedRiskEntry {
    <# Returns the problems of one accepted-risks entry (empty when it is valid). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Entry,
        [string[]]$KnownTool = $script:FindingSteps,
        [datetime]$Today = [datetime]::UtcNow.Date
    )
    $problems = New-Object System.Collections.Generic.List[string]
    $allowed = @('tool', 'ruleId', 'resource', 'reason', 'date', 'reference')
    foreach ($property in $Entry.PSObject.Properties) {
        if ($allowed -notcontains $property.Name) { $problems.Add("unknown property '$($property.Name)' (allowed: $($allowed -join ', '))") }
    }
    $tool = [string](Get-PropertyValue -InputObject $Entry -Name 'tool' -Default '')
    if ($KnownTool -notcontains $tool) { $problems.Add("tool '$tool' must be one of: $($KnownTool -join ', ')") }
    foreach ($field in @('ruleId', 'resource')) {
        $value = [string](Get-PropertyValue -InputObject $Entry -Name $field -Default '')
        if ([string]::IsNullOrWhiteSpace($value)) { $problems.Add("$field is required") }
        elseif ($value -match '[*?]') { $problems.Add("$field must not contain a wildcard ('*' or '?'): one entry per rule id AND resource") }
        elseif ($value -ne $value.Trim()) { $problems.Add("$field must not have leading or trailing whitespace") }
    }
    $reason = [string](Get-PropertyValue -InputObject $Entry -Name 'reason' -Default '')
    if ($reason.Trim().Length -lt 20) { $problems.Add('reason is required: a written reason of at least 20 characters (why this risk is acceptable)') }
    $date = [string](Get-PropertyValue -InputObject $Entry -Name 'date' -Default '')
    $parsed = [datetime]::MinValue
    if (-not [datetime]::TryParseExact($date, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) { $problems.Add('date is required as yyyy-MM-dd') }
    elseif ($parsed.Date -gt $Today.Date) { $problems.Add("date $date is in the future") }
    return $problems.ToArray()
}

function Read-AcceptedRiskFile {
    <# Returns the entries of accepted-risks.json; throws one error that lists every problem. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$KnownTool = $script:FindingSteps,
        [datetime]$Today = [datetime]::UtcNow.Date
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Accepted-risks file not found: $Path" }
    $document = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Path))
    $problems = New-Object System.Collections.Generic.List[string]
    if ((Get-PropertyValue -InputObject $document -Name 'schemaVersion') -ne 1) { $problems.Add('schemaVersion must be 1') }
    $risksProperty = $document.PSObject.Properties['risks']
    if ($null -eq $risksProperty) { $problems.Add('"risks" (an array) is missing') }
    $entries = @()
    if ($null -ne $risksProperty) { $entries = @($risksProperty.Value) }
    $seen = @{}
    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        foreach ($problem in @(Test-AcceptedRiskEntry -Entry $entry -KnownTool $KnownTool -Today $Today)) { $problems.Add(('risks[{0}]: {1}' -f $index, $problem)) }
        $key = '{0}|{1}|{2}' -f (Get-PropertyValue -InputObject $entry -Name 'tool' -Default ''), (Get-PropertyValue -InputObject $entry -Name 'ruleId' -Default ''), (Get-PropertyValue -InputObject $entry -Name 'resource' -Default '')
        if ($seen.ContainsKey($key)) { $problems.Add(('risks[{0}]: duplicate of risks[{1}] (same tool, ruleId and resource)' -f $index, $seen[$key])) }
        else { $seen[$key] = $index }
    }
    if ($problems.Count -gt 0) { throw ("Invalid accepted-risks.json:`n  " + ($problems -join "`n  ")) }
    return $entries
}

function Resolve-Finding {
    <# Splits findings into Open (fail the step) and Accepted (an exact tool + ruleId + resource entry exists). Also reports the
       entries of this tool that matched no finding (Stale). Matching is exact and case-sensitive. #>
    [CmdletBinding()]
    param([object[]]$Finding = @(), [object[]]$Risk = @(), [Parameter(Mandatory)][string]$Tool)
    $toolRisks = @($Risk | Where-Object { $_.tool -ceq $Tool })
    $open = New-Object System.Collections.Generic.List[object]
    $accepted = New-Object System.Collections.Generic.List[object]
    $used = @{}
    foreach ($item in @($Finding)) {
        $match = $null
        foreach ($candidate in $toolRisks) {
            if ($candidate.ruleId -ceq $item.RuleId -and $candidate.resource -ceq $item.Resource) { $match = $candidate; break }
        }
        if ($null -eq $match) { $open.Add($item) }
        else {
            $accepted.Add($item)
            $used['{0}|{1}' -f $match.ruleId, $match.resource] = $true
        }
    }
    $stale = @($toolRisks | Where-Object { -not $used.ContainsKey(('{0}|{1}' -f $_.ruleId, $_.resource)) })
    return [pscustomobject]@{ Open = $open.ToArray(); Accepted = $accepted.ToArray(); Stale = $stale }
}

# ---------------------------------------------------------------------------------------------------------------------
# Results, selection, exit code
# ---------------------------------------------------------------------------------------------------------------------

function New-StepResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Step,
        [Parameter(Mandatory)][ValidateSet('PASS', 'FAIL', 'SKIP', 'WARN')][string]$Status,
        [string]$Detail = '',
        [object[]]$Finding = @(),
        [string[]]$Note = @()
    )
    return [pscustomobject]@{ Step = $Step; Status = $Status; Detail = $Detail; Finding = @($Finding); Note = @($Note); Seconds = 0.0 }
}

function Get-ValidationExitCode {
    <# 1 when any step FAILED; SKIP and WARN never fail the run. #>
    [CmdletBinding()]
    param([object[]]$Result = @())
    if (@($Result | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) { return 1 }
    return 0
}

function Format-ResultLine {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Result)
    return ('{0,-4} {1,-17} {2}' -f $Result.Status, $Result.Step, $Result.Detail).TrimEnd()
}

function Resolve-StepSelection {
    <# The steps to run, in the fixed order. -Only narrows, -Skip removes; an unknown name throws. Names may arrive as
       "a,b" in one string (powershell -File does not split commas). #>
    [CmdletBinding()]
    param([string[]]$Only = @(), [string[]]$Skip = @())
    $splitNames = {
        param($Values)
        @($Values | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
    }
    $onlyNames = @(& $splitNames $Only)
    $skipNames = @(& $splitNames $Skip)
    foreach ($name in @($onlyNames) + @($skipNames)) {
        if ($script:StepNames -notcontains $name) { throw ("Unknown step '{0}'. Steps: {1}" -f $name, ($script:StepNames -join ', ')) }
    }
    $selected = @($script:StepNames)
    if ($onlyNames.Count -gt 0) { $selected = @($selected | Where-Object { $onlyNames -contains $_ }) }
    return @($selected | Where-Object { $skipNames -notcontains $_ })
}

function New-ValidationContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$ToolsDir,
        [Parameter(Mandatory)][string]$OutputDir,
        [Parameter(Mandatory)]$Lock,
        [object[]]$Risk = @(),
        [string[]]$TrivyImage = $script:DefaultTrivyImages,
        [bool]$Rehearsal = $false,
        [bool]$StrictImages = $false
    )
    return [pscustomobject]@{
        RepoRoot = $RepoRoot; ToolsDir = $ToolsDir; OutputDir = $OutputDir; Lock = $Lock
        Risk = @($Risk); TrivyImage = @($TrivyImage); Rehearsal = $Rehearsal; StrictImages = $StrictImages
    }
}

function Complete-FindingStep {
    <# Applies the accepted risks to a step's findings, writes the full list to the output directory and returns the result. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$Step,
        [object[]]$Finding = @(),
        [string]$Summary = '',
        [string[]]$Problem = @()
    )
    $resolved = Resolve-Finding -Finding $Finding -Risk $Context.Risk -Tool $Step
    $everything = @($resolved.Open | ForEach-Object { $_ | Add-Member -NotePropertyName Accepted -NotePropertyValue $false -PassThru -Force }) +
    @($resolved.Accepted | ForEach-Object { $_ | Add-Member -NotePropertyName Accepted -NotePropertyValue $true -PassThru -Force })
    $findingsPath = Join-Path -Path $Context.OutputDir -ChildPath ($Step + '-findings.json')
    [System.IO.File]::WriteAllText($findingsPath, (ConvertTo-Json -InputObject @($everything) -Depth 5))
    $notes = New-Object System.Collections.Generic.List[string]
    foreach ($stale in $resolved.Stale) { $notes.Add(('accepted risk matches no finding any more (remove it?): {0} {1}' -f $stale.ruleId, $stale.resource)) }
    foreach ($item in $Problem) { $notes.Add($item) }
    $detail = $Summary
    if ($detail) { $detail = $detail + '; ' }
    $detail = $detail + ('{0} finding(s): {1} open, {2} accepted' -f @($Finding).Count, $resolved.Open.Count, $resolved.Accepted.Count)
    $status = 'PASS'
    if ($resolved.Open.Count -gt 0 -or @($Problem).Count -gt 0) { $status = 'FAIL' }
    return (New-StepResult -Step $Step -Status $status -Detail $detail -Finding $resolved.Open -Note $notes.ToArray())
}

function Write-StepResult {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Result, [Parameter(Mandatory)][string]$OutputDir)
    Write-Say -Text (Format-ResultLine -Result $Result)
    $shown = 0
    foreach ($item in @($Result.Finding)) {
        if ($shown -ge $script:MaxFindingsPrinted) {
            Write-Say -Text ('       ... {0} more open finding(s): see {1}' -f (@($Result.Finding).Count - $shown), (Join-Path -Path $OutputDir -ChildPath ($Result.Step + '-findings.json')))
            break
        }
        $message = [string]$item.Message
        if ($message.Length -gt 150) { $message = $message.Substring(0, 147) + '...' }
        Write-Say -Text ('       - {0} {1} [{2}] {3}' -f $item.RuleId, $item.Resource, $item.Severity, $message)
        $shown++
    }
    foreach ($note in @($Result.Note)) { Write-Say -Text ('       note: ' + $note) }
}

# ---------------------------------------------------------------------------------------------------------------------
# Parsers (pure: text in, findings out)
# ---------------------------------------------------------------------------------------------------------------------

function ConvertFrom-BicepDiagnosticText {
    <# `path(line,col) : Warning rule-id: message [url]`. Only Error and Warning count; Info does not. #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$RepoRoot)
    $found = @{}
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($line in (($Text -replace "`r", '') -split "`n")) {
        if ($line -match '^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\) : (?<sev>Error|Warning|Info) (?<rule>[A-Za-z0-9_.\-]+): (?<msg>.*)$') {
            if ($Matches['sev'] -eq 'Info') { continue }
            $file = ConvertTo-RepoRelativePath -Path $Matches['file'] -RepoRoot $RepoRoot
            $key = '{0}|{1}|{2}|{3}' -f $file, $Matches['line'], $Matches['col'], $Matches['rule']
            if ($found.ContainsKey($key)) { continue }
            $found[$key] = $true
            $items.Add((New-Finding -Tool 'bicep' -RuleId $Matches['rule'] -Resource $file -Severity $Matches['sev'] -Message ('line {0}: {1}' -f $Matches['line'], $Matches['msg'])))
        }
    }
    return $items.ToArray()
}

function ConvertFrom-PSRuleResult {
    <# The JSON the child script writes: { results: [ { ruleName, outcome, targetName, targetType, level, ref, reason } ] }. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Document)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($result in @(Get-PropertyValue -InputObject $Document -Name 'results' -Default @())) {
        if ((Get-PropertyValue -InputObject $result -Name 'outcome') -notin @('Fail', 'Error')) { continue }
        $resource = '{0}/{1}' -f (Get-PropertyValue -InputObject $result -Name 'targetType' -Default ''), (Get-PropertyValue -InputObject $result -Name 'targetName' -Default '')
        $reason = (@(Get-PropertyValue -InputObject $result -Name 'reason' -Default @()) -join ' ')
        $items.Add((New-Finding -Tool 'psrule' -RuleId ([string](Get-PropertyValue -InputObject $result -Name 'ruleName')) -Resource $resource -Severity ([string](Get-PropertyValue -InputObject $result -Name 'level' -Default '')) -Message ('{0} {1}' -f (Get-PropertyValue -InputObject $result -Name 'ref' -Default ''), $reason).Trim()))
    }
    return $items.ToArray()
}

function ConvertFrom-CheckovJson {
    <# `checkov -o json` prints one object per framework (an array when several ran). #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [string]$MountRoot = '/tf/')
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($document in @(Get-JsonItem -Text $Text)) {
        $results = Get-PropertyValue -InputObject $document -Name 'results'
        foreach ($failed in @(Get-PropertyValue -InputObject $results -Name 'failed_checks' -Default @())) {
            $file = [string](Get-PropertyValue -InputObject $failed -Name 'file_path' -Default '')
            if ($file.StartsWith($MountRoot)) { $file = $file.Substring($MountRoot.Length) }
            $file = $file.TrimStart('/')
            $range = @(Get-PropertyValue -InputObject $failed -Name 'file_line_range' -Default @())
            $where = $file
            if ($range.Count -gt 0) { $where = '{0}:{1}' -f $file, $range[0] }
            $resource = '{0}#{1}' -f $file, (Get-PropertyValue -InputObject $failed -Name 'resource' -Default '')
            $severity = [string](Get-PropertyValue -InputObject $failed -Name 'severity' -Default '')   # null in the open-source edition
            if (-not $severity) { $severity = 'unrated' }
            $items.Add((New-Finding -Tool 'checkov' -RuleId ([string](Get-PropertyValue -InputObject $failed -Name 'check_id')) -Resource $resource -Severity $severity -Message ('{0} ({1})' -f (Get-PropertyValue -InputObject $failed -Name 'check_name' -Default ''), $where)))
        }
    }
    return $items.ToArray()
}

function Get-CheckovSummary {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text)
    $passed = 0
    $failed = 0
    $parsingErrors = 0
    foreach ($document in @(Get-JsonItem -Text $Text)) {
        $summary = Get-PropertyValue -InputObject $document -Name 'summary'
        $passed += [int](Get-PropertyValue -InputObject $summary -Name 'passed' -Default 0)
        $failed += [int](Get-PropertyValue -InputObject $summary -Name 'failed' -Default 0)
        $parsingErrors += [int](Get-PropertyValue -InputObject $summary -Name 'parsing_errors' -Default 0)
    }
    return [pscustomobject]@{ Passed = $passed; Failed = $failed; ParsingErrors = $parsingErrors }
}

function ConvertFrom-ActionlintJson {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$RepoRoot)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @(Get-JsonItem -Text $Text)) {
        $file = ConvertTo-RepoRelativePath -Path ([string](Get-PropertyValue -InputObject $entry -Name 'filepath' -Default '')) -RepoRoot $RepoRoot
        $items.Add((New-Finding -Tool 'actionlint' -RuleId ([string](Get-PropertyValue -InputObject $entry -Name 'kind' -Default 'unknown')) -Resource $file -Severity 'error' -Message ('line {0}: {1}' -f (Get-PropertyValue -InputObject $entry -Name 'line' -Default 0), (Get-PropertyValue -InputObject $entry -Name 'message' -Default ''))))
    }
    return $items.ToArray()
}

function ConvertFrom-HadolintJson {
    <# Levels error, warning and info count (hadolint's own default failure threshold is info); style does not. #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$RepoRoot)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @(Get-JsonItem -Text $Text)) {
        $level = [string](Get-PropertyValue -InputObject $entry -Name 'level' -Default '')
        if ($level -eq 'style') { continue }
        $file = ConvertTo-RepoRelativePath -Path ([string](Get-PropertyValue -InputObject $entry -Name 'file' -Default '')) -RepoRoot $RepoRoot
        $items.Add((New-Finding -Tool 'hadolint' -RuleId ([string](Get-PropertyValue -InputObject $entry -Name 'code' -Default '')) -Resource $file -Severity $level -Message ('line {0}: {1}' -f (Get-PropertyValue -InputObject $entry -Name 'line' -Default 0), (Get-PropertyValue -InputObject $entry -Name 'message' -Default ''))))
    }
    return $items.ToArray()
}

function ConvertFrom-ShellcheckJson {
    <# `shellcheck --format=json1`: { comments: [ { file, line, level, code, message } ] }. #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$RepoRoot)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($document in @(Get-JsonItem -Text $Text)) {
        foreach ($comment in @(Get-PropertyValue -InputObject $document -Name 'comments' -Default @())) {
            $file = ConvertTo-RepoRelativePath -Path ([string](Get-PropertyValue -InputObject $comment -Name 'file' -Default '')) -RepoRoot $RepoRoot
            $items.Add((New-Finding -Tool 'shellcheck' -RuleId ('SC{0}' -f (Get-PropertyValue -InputObject $comment -Name 'code' -Default 0)) -Resource $file -Severity ([string](Get-PropertyValue -InputObject $comment -Name 'level' -Default '')) -Message ('line {0}: {1}' -f (Get-PropertyValue -InputObject $comment -Name 'line' -Default 0), (Get-PropertyValue -InputObject $comment -Name 'message' -Default ''))))
        }
    }
    return $items.ToArray()
}

function ConvertFrom-AnalyzerJson {
    <# The JSON psscriptanalyzer-run.ps1 writes: an array of { RuleName, Severity, ScriptPath, Line, Message }. #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$RepoRoot)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @(Get-JsonItem -Text $Text)) {
        $file = ConvertTo-RepoRelativePath -Path ([string](Get-PropertyValue -InputObject $entry -Name 'ScriptPath' -Default '')) -RepoRoot $RepoRoot
        $items.Add((New-Finding -Tool 'psscriptanalyzer' -RuleId ([string](Get-PropertyValue -InputObject $entry -Name 'RuleName' -Default '')) -Resource $file -Severity ([string](Get-PropertyValue -InputObject $entry -Name 'Severity' -Default '')) -Message ('line {0}: {1}' -f (Get-PropertyValue -InputObject $entry -Name 'Line' -Default 0), (Get-PropertyValue -InputObject $entry -Name 'Message' -Default ''))))
    }
    return $items.ToArray()
}

function ConvertFrom-TrivyJson {
    <# HIGH and CRITICAL vulnerabilities of `trivy image -f json`. One finding per CVE and package (Resource = image:package). #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [Parameter(Mandatory)][string]$Image)
    $found = @{}
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($document in @(Get-JsonItem -Text $Text)) {
        foreach ($result in @(Get-PropertyValue -InputObject $document -Name 'Results' -Default @())) {
            foreach ($vulnerability in @(Get-PropertyValue -InputObject $result -Name 'Vulnerabilities' -Default @())) {
                $severity = [string](Get-PropertyValue -InputObject $vulnerability -Name 'Severity' -Default '')
                if ($severity -notin @('HIGH', 'CRITICAL')) { continue }
                $id = [string](Get-PropertyValue -InputObject $vulnerability -Name 'VulnerabilityID' -Default '')
                $package = [string](Get-PropertyValue -InputObject $vulnerability -Name 'PkgName' -Default '')
                $resource = '{0}:{1}' -f $Image, $package
                $key = $id + '|' + $resource
                if ($found.ContainsKey($key)) { continue }
                $found[$key] = $true
                $fixed = [string](Get-PropertyValue -InputObject $vulnerability -Name 'FixedVersion' -Default '')
                if (-not $fixed) { $fixed = 'no fix published' } else { $fixed = 'fixed in ' + $fixed }
                $items.Add((New-Finding -Tool 'trivy-image' -RuleId $id -Resource $resource -Severity $severity -Message ('{0} {1} ({2}): {3}' -f $package, (Get-PropertyValue -InputObject $vulnerability -Name 'InstalledVersion' -Default ''), $fixed, (Get-PropertyValue -InputObject $vulnerability -Name 'Title' -Default ''))))
            }
        }
    }
    return $items.ToArray()
}

# ---------------------------------------------------------------------------------------------------------------------
# Dummy environment for the parameter files (no secret: every value is made up for this run)
# ---------------------------------------------------------------------------------------------------------------------

function Get-DummyParameterEnvironment {
    <# Every variable infra/bicep/main.bicepparam and bootstrap.bicepparam read, with made-up values: the real contract names
       are in the parameter files' header comments. A new password is made per call (64 hex characters). #>
    [CmdletBinding()]
    param()
    $hex = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
    return @{
        ACR_NAME              = 'acrsbdummy'
        APPS_IDENTITY_ID      = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-sb-dummy/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-dummy'
        POSTGRES_VERSION      = '17'
        PG_ADMIN_PASSWORD     = $hex
        GIT_SHA               = '0123456789abcdef0123456789abcdef01234567'
        DEPLOY_APPS           = 'true'
        API_IMAGE             = 'acrsbdummy.azurecr.io/stellar-blaze-api:dummy'
        API_TARGET_PORT       = '8000'
        API_LIVE_PATH         = '/health/live'
        API_READY_PATH        = '/health/ready'
        API_IS_PLACEHOLDER    = 'false'
        WEB_IMAGE             = 'acrsbdummy.azurecr.io/stellar-blaze-web:dummy'
        WEB_TARGET_PORT       = '3000'
        WEB_HEALTH_PATH       = '/api/health'
        WEB_IS_PLACEHOLDER    = 'false'
        JOBS_IMAGE            = 'acrsbdummy.azurecr.io/stellar-blaze-api:dummy'
        VAPID_PUBLIC_KEY      = 'dummy-public-key'
        VAPID_SUBJECT         = 'mailto:dummy@example.com'
        VAPID_PRIVATE_KEY     = 'dummy-private-key'
        SB_ACCESS_TOKENS      = ('{{"{0}":{{"actor":"dummy","role":"employer","employer_id":"dummy"}}}}' -f $hex)
        DEMO_EMPLOYER_TOKEN   = 'dummy-employer-token'
        BUDGET_CONTACT_EMAIL  = 'dummy@example.com'
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# Steps. Each takes the context and returns a step result; a thrown error is turned into FAIL or SKIP by the caller.
# ---------------------------------------------------------------------------------------------------------------------

function Get-RepoFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$RelativeDirectory, [string[]]$Include = @(), [switch]$Recurse)
    $directory = Join-Path -Path $Context.RepoRoot -ChildPath $RelativeDirectory
    if (-not (Test-Path -LiteralPath $directory)) { return @() }
    $arguments = @{ LiteralPath = $directory; File = $true }
    if ($Recurse) { $arguments['Recurse'] = $true }
    $files = @(Get-ChildItem @arguments)
    if ($Include.Count -gt 0) { $files = @($files | Where-Object { $name = $_.Name; @($Include | Where-Object { $name -like $_ }).Count -gt 0 }) }
    return @($files | Sort-Object -Property FullName)
}

function Invoke-StepBicep {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $bicep = Install-LockedTool -Context $Context -Name 'bicep'
    $out = $Context.OutputDir
    $findings = New-Object System.Collections.Generic.List[object]
    $problems = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    $addFindings = {
        param($Text)
        foreach ($item in @(ConvertFrom-BicepDiagnosticText -Text $Text -RepoRoot $Context.RepoRoot)) {
            $key = '{0}|{1}|{2}' -f $item.RuleId, $item.Resource, $item.Message
            if (-not $seen.ContainsKey($key)) { $seen[$key] = $true; $findings.Add($item) }
        }
    }
    $sources = @(Get-RepoFile -Context $Context -RelativeDirectory 'infra\bicep' -Include @('*.bicep') -Recurse)
    if ($sources.Count -eq 0) { Stop-Step -Kind Unavailable -Message 'no .bicep file under infra/bicep' }
    $linted = 0
    foreach ($source in $sources) {
        $result = Invoke-Native -FilePath $bicep -Argument @('lint', $source.FullName) -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $out -ChildPath ('bicep-lint-' + $source.BaseName)) -TimeoutSeconds 300
        & $addFindings ($result.StdErr + "`n" + $result.StdOut)
        $parsedErrors = @($findings | Where-Object { $_.Severity -eq 'Error' }).Count
        if ($result.ExitCode -ne 0 -and $parsedErrors -eq 0) { $problems.Add(('bicep lint {0} exited {1}: {2}' -f $source.Name, $result.ExitCode, (Get-TextTail -Text $result.StdErr -Lines 2))) }
        $linted++
    }
    $built = 0
    foreach ($name in @('bootstrap.bicep', 'main.bicep')) {
        $path = Join-Path -Path $Context.RepoRoot -ChildPath ('infra\bicep\' + $name)
        if (-not (Test-Path -LiteralPath $path)) { $problems.Add("infra/bicep/$name does not exist yet"); continue }
        $result = Invoke-Native -FilePath $bicep -Argument @('build', $path, '--outfile', (Join-Path -Path $out -ChildPath ($name + '.json'))) -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $out -ChildPath ('bicep-build-' + $name)) -TimeoutSeconds 300
        & $addFindings ($result.StdErr + "`n" + $result.StdOut)
        if ($result.ExitCode -ne 0) { $problems.Add(('bicep build {0} exited {1}: {2}' -f $name, $result.ExitCode, (Get-TextTail -Text $result.StdErr -Lines 2))) }
        else { $built++ }
    }
    $parameterFiles = 0
    foreach ($name in @('bootstrap.bicepparam', 'main.bicepparam')) {
        $path = Join-Path -Path $Context.RepoRoot -ChildPath ('infra\bicep\' + $name)
        if (-not (Test-Path -LiteralPath $path)) { $problems.Add("infra/bicep/$name does not exist yet"); continue }
        $result = Invoke-Native -FilePath $bicep -Argument @('build-params', $path, '--outfile', (Join-Path -Path $out -ChildPath ($name + '.json'))) -WorkingDirectory $Context.RepoRoot -Environment (Get-DummyParameterEnvironment) -LogPrefix (Join-Path -Path $out -ChildPath ('bicep-build-params-' + $name)) -TimeoutSeconds 300
        & $addFindings ($result.StdErr + "`n" + $result.StdOut)
        if ($result.ExitCode -ne 0) { $problems.Add(('bicep build-params {0} exited {1}: {2}' -f $name, $result.ExitCode, (Get-TextTail -Text $result.StdErr -Lines 2))) }
        else { $parameterFiles++ }
    }
    $summary = 'bicep {0}: lint {1} file(s), build {2}, build-params {3}' -f $Context.Lock.binaries.bicep.version, $linted, $built, $parameterFiles
    return (Complete-FindingStep -Context $Context -Step 'bicep' -Finding $findings.ToArray() -Summary $summary -Problem $problems.ToArray())
}

function Invoke-StepPsrule {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $bicep = Install-LockedTool -Context $Context -Name 'bicep'
    [void](Install-LockedPsModule -Context $Context -Name @('PSRule', 'PSRule.Rules.Azure'))
    $inputs = @('main.bicepparam', 'bootstrap.bicepparam')
    foreach ($name in $inputs) {
        if (-not (Test-Path -LiteralPath (Join-Path -Path $Context.RepoRoot -ChildPath ('infra\bicep\' + $name)))) { Stop-Step -Kind Unavailable -Message "infra/bicep/$name does not exist yet" }
    }
    $resultPath = Join-Path -Path $Context.OutputDir -ChildPath 'psrule-results.json'
    $runner = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\validate\psrule-run.ps1'
    $option = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\validate\ps-rule.yaml'
    $environment = Get-ChildHostEnvironment -Context $Context -Extra (Get-DummyParameterEnvironment)
    $environment['PSRULE_AZURE_BICEP_PATH'] = $bicep
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $runner,
        '-InputPath', (($inputs | ForEach-Object { Join-Path -Path $Context.RepoRoot -ChildPath ('infra\bicep\' + $_) }) -join ';'),
        '-OptionPath', $option, '-OutputPath', $resultPath)
    $run = Invoke-Native -FilePath (Get-HostExecutable) -Argument $arguments -WorkingDirectory $Context.RepoRoot -Environment $environment -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'psrule') -TimeoutSeconds 900
    if (-not (Test-Path -LiteralPath $resultPath)) { return (New-StepResult -Step 'psrule' -Status FAIL -Detail ('PSRule produced no result file (exit {0}): {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $document = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($resultPath))
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($message in @(Get-PropertyValue -InputObject $document -Name 'errors' -Default @())) { $problems.Add('PSRule error: ' + $message) }
    foreach ($message in @(Get-PropertyValue -InputObject $document -Name 'warnings' -Default @())) { $problems.Add('PSRule warning: ' + $message) }
    $all = @(Get-PropertyValue -InputObject $document -Name 'results' -Default @())
    foreach ($name in $inputs) {
        $analysed = @($all | Where-Object { [string](Get-PropertyValue -InputObject $_ -Name 'source' -Default '') -like ('*' + $name + '*') }).Count
        if ($analysed -eq 0) { $problems.Add("nothing was analysed for $name (the Bicep expansion produced no resource)") }
    }
    if ($run.ExitCode -ne 0 -and $problems.Count -eq 0) { $problems.Add(('PSRule child exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $summary = 'PSRule {0} + PSRule.Rules.Azure {1} (default baseline): {2} rule result(s)' -f $Context.Lock.psModules.PSRule.version, $Context.Lock.psModules.'PSRule.Rules.Azure'.version, $all.Count
    return (Complete-FindingStep -Context $Context -Step 'psrule' -Finding @(ConvertFrom-PSRuleResult -Document $document) -Summary $summary -Problem $problems.ToArray())
}

function Invoke-StepCheckov {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $bicep = Install-LockedTool -Context $Context -Name 'bicep'
    $reference = Install-LockedImage -Context $Context -Name 'checkov'
    # Checkov's own Bicep parser (pycep) cannot read `import { ... } from` or `export type`, so its bicep framework silently
    # skips main.bicep and most modules (parsing_errors > 0 in its summary). The Bicep CLI is the authority on the language:
    # build the templates with the pinned CLI and scan the compiled ARM JSON (nested modules included) with Checkov's arm framework.
    $scanDirectory = Join-Path -Path $Context.OutputDir -ChildPath 'checkov-input'
    if (-not (Test-Path -LiteralPath $scanDirectory)) { New-Item -ItemType Directory -Path $scanDirectory -Force | Out-Null }
    $problems = New-Object System.Collections.Generic.List[string]
    $built = 0
    foreach ($name in @('bootstrap', 'main')) {
        $source = Join-Path -Path $Context.RepoRoot -ChildPath ('infra\bicep\{0}.bicep' -f $name)
        if (-not (Test-Path -LiteralPath $source)) { $problems.Add("infra/bicep/$name.bicep does not exist yet"); continue }
        $build = Invoke-Native -FilePath $bicep -Argument @('build', $source, '--outfile', (Join-Path -Path $scanDirectory -ChildPath ($name + '.json'))) -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath ('checkov-build-' + $name)) -TimeoutSeconds 300
        if ($build.ExitCode -ne 0) { $problems.Add(('bicep build {0} exited {1}' -f $name, $build.ExitCode)) } else { $built++ }
    }
    if ($built -eq 0) { Stop-Step -Kind Unavailable -Message 'no template could be built for the scan' }
    # --network none: the scan is offline by construction (no telemetry, no external-check download).
    $arguments = @('run', '--rm', '--network', 'none', '-v', ('{0}:/tf:ro' -f $scanDirectory),
        '-e', 'BC_SKIP_MAPPING=TRUE',
        $reference, '-d', '/tf', '--framework', 'arm', '--output', 'json', '--skip-download', '--quiet')
    $run = Invoke-Native -FilePath 'docker' -Argument $arguments -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'checkov') -TimeoutSeconds 900
    if ($run.ExitCode -notin @(0, 1)) { $problems.Add(('checkov exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $summary = Get-CheckovSummary -Text $run.StdOut
    if ($run.ExitCode -in @(0, 1) -and ($summary.Passed + $summary.Failed) -eq 0) { $problems.Add('checkov evaluated no check (no resource parsed from the compiled templates)') }
    if ($summary.ParsingErrors -gt 0) { $problems.Add(('checkov could not parse {0} file(s): part of the templates was not scanned' -f $summary.ParsingErrors)) }
    $findings = @(ConvertFrom-CheckovJson -Text $run.StdOut)
    return (Complete-FindingStep -Context $Context -Step 'checkov' -Finding $findings -Summary ('checkov {0} (arm framework on the compiled templates): {1} passed, {2} failed check(s)' -f $Context.Lock.images.checkov.tag, $summary.Passed, $summary.Failed) -Problem $problems.ToArray())
}

function Invoke-StepActionlint {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $actionlint = Install-LockedTool -Context $Context -Name 'actionlint'
    [void](Install-LockedTool -Context $Context -Name 'shellcheck')
    $workflows = @(Get-RepoFile -Context $Context -RelativeDirectory '.github\workflows' -Include @('*.yml', '*.yaml'))
    if ($workflows.Count -eq 0) { Stop-Step -Kind Unavailable -Message 'no workflow under .github/workflows' }
    $arguments = @('-no-color', '-format', '{{json .}}') + @($workflows | ForEach-Object { $_.FullName })
    $environment = Get-ChildHostEnvironment -Context $Context
    $run = Invoke-Native -FilePath $actionlint -Argument $arguments -WorkingDirectory $Context.RepoRoot -Environment $environment -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'actionlint') -TimeoutSeconds 300
    $problems = New-Object System.Collections.Generic.List[string]
    if ($run.ExitCode -notin @(0, 1)) { $problems.Add(('actionlint exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $findings = @(ConvertFrom-ActionlintJson -Text $run.StdOut -RepoRoot $Context.RepoRoot)
    $names = (@($workflows | ForEach-Object { $_.Name }) -join ', ')
    return (Complete-FindingStep -Context $Context -Step 'actionlint' -Finding $findings -Summary ('actionlint {0} (with shellcheck {1}) on {2}' -f $Context.Lock.binaries.actionlint.version, $Context.Lock.binaries.shellcheck.version, $names) -Problem $problems.ToArray())
}

function Test-WorkflowHasJob {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$WorkflowPath, [Parameter(Mandatory)][string]$Job)
    if (-not (Test-Path -LiteralPath $WorkflowPath)) { return $false }
    $inJobs = $false
    foreach ($line in [System.IO.File]::ReadAllLines($WorkflowPath)) {
        if ($line -match '^jobs:\s*$') { $inJobs = $true; continue }
        if ($inJobs -and $line -match '^\S') { $inJobs = $false }
        if ($inJobs -and $line -match ('^  {0}:\s*$' -f [regex]::Escape($Job))) { return $true }
    }
    return $false
}

function Invoke-StepAct {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $workflow = Join-Path -Path $Context.RepoRoot -ChildPath '.github\workflows\ci.yml'
    if (-not (Test-WorkflowHasJob -WorkflowPath $workflow -Job 'infra')) { return (New-StepResult -Step 'act' -Status SKIP -Detail 'the infra job does not exist in .github/workflows/ci.yml yet') }
    $unavailable = Test-DockerAvailable
    if ($unavailable) { return (New-StepResult -Step 'act' -Status SKIP -Detail $unavailable) }
    $act = Install-LockedTool -Context $Context -Name 'act'
    # -n: dry run. act reads the workflow, resolves the job and walks its steps without running one and without pulling an
    # image, so the image named here is never used (naming one also stops act's first-run image-size prompt).
    $arguments = @('-n', '-j', 'infra', '-W', $workflow, '-P', 'ubuntu-24.04=act-dry-run-image-never-pulled', '--pull=false',
        '--container-architecture', 'linux/amd64', '--action-cache-path', (Join-Path -Path $Context.ToolsDir -ChildPath 'act-cache'))
    $run = Invoke-Native -FilePath $act -Argument $arguments -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'act') -TimeoutSeconds 600
    if ($run.ExitCode -ne 0) { return (New-StepResult -Step 'act' -Status FAIL -Detail ('act {0} dry run of the infra job exited {1}: {2}' -f $Context.Lock.binaries.act.version, $run.ExitCode, (Get-TextTail -Text ($run.StdErr + ' ' + $run.StdOut) -Lines 2))) }
    return (New-StepResult -Step 'act' -Status PASS -Detail ('act {0}: dry run of the infra job of ci.yml' -f $Context.Lock.binaries.act.version))
}

function Invoke-StepHadolint {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $hadolint = Install-LockedTool -Context $Context -Name 'hadolint'
    $dockerfiles = @('backend/Dockerfile', 'frontend/Dockerfile') | Where-Object { Test-Path -LiteralPath (Join-Path -Path $Context.RepoRoot -ChildPath $_) }
    if (@($dockerfiles).Count -eq 0) { Stop-Step -Kind Unavailable -Message 'no Dockerfile in backend/ or frontend/' }
    $run = Invoke-Native -FilePath $hadolint -Argument (@('--no-color', '--format', 'json') + @($dockerfiles)) -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'hadolint') -TimeoutSeconds 300
    $problems = New-Object System.Collections.Generic.List[string]
    if ($run.ExitCode -notin @(0, 1)) { $problems.Add(('hadolint exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $findings = @(ConvertFrom-HadolintJson -Text $run.StdOut -RepoRoot $Context.RepoRoot)
    return (Complete-FindingStep -Context $Context -Step 'hadolint' -Finding $findings -Summary ('hadolint {0} on {1}' -f $Context.Lock.binaries.hadolint.version, (@($dockerfiles) -join ', ')) -Problem $problems.ToArray())
}

function Invoke-StepTrivyImage {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $unavailable = Test-DockerAvailable
    if ($unavailable) { Stop-Step -Kind Unavailable -Message $unavailable }
    $missing = @($Context.TrivyImage | Where-Object { (Invoke-Native -FilePath 'docker' -Argument @('image', 'inspect', '--format', '{{.Id}}', $_) -TimeoutSeconds 60).ExitCode -ne 0 })
    if ($missing.Count -gt 0) { Stop-Step -Kind Unavailable -Message ('image(s) not built locally: ' + ($missing -join ', ')) }
    $trivy = Install-LockedTool -Context $Context -Name 'trivy'
    $cache = Join-Path -Path $Context.ToolsDir -ChildPath 'trivy-cache'
    $findings = New-Object System.Collections.Generic.List[object]
    $problems = New-Object System.Collections.Generic.List[string]
    $counts = New-Object System.Collections.Generic.List[string]
    foreach ($image in $Context.TrivyImage) {
        $safe = $image -replace '[^A-Za-z0-9_.-]', '_'
        $tar = Join-Path -Path $Context.OutputDir -ChildPath ('image-' + $safe + '.tar')
        $report = Join-Path -Path $Context.OutputDir -ChildPath ('trivy-' + $safe + '.json')
        $save = Invoke-Native -FilePath 'docker' -Argument @('save', '--output', $tar, $image) -TimeoutSeconds 900
        if ($save.ExitCode -ne 0) { $problems.Add(('docker save {0} failed: {1}' -f $image, (Get-TextTail -Text $save.StdErr -Lines 2))); continue }
        $scan = Invoke-Native -FilePath $trivy -Argument @('image', '--input', $tar, '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--format', 'json', '--output', $report,
            '--cache-dir', $cache, '--skip-java-db-update', '--no-progress', '--quiet', '--exit-code', '0', '--timeout', '60m') -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath ('trivy-' + $safe)) -TimeoutSeconds 1800
        Remove-Item -LiteralPath $tar -Force -ErrorAction SilentlyContinue
        if ($scan.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $report)) { $problems.Add(('trivy image {0} exited {1}: {2}' -f $image, $scan.ExitCode, (Get-TextTail -Text $scan.StdErr -Lines 3))); continue }
        $imageFindings = @(ConvertFrom-TrivyJson -Text ([System.IO.File]::ReadAllText($report)) -Image $image)
        foreach ($item in $imageFindings) { $findings.Add($item) }
        $high = @($imageFindings | Where-Object { $_.Severity -eq 'HIGH' }).Count
        $critical = @($imageFindings | Where-Object { $_.Severity -eq 'CRITICAL' }).Count
        $packages = (@($imageFindings | ForEach-Object { $_.Resource.Substring($image.Length + 1) } | Sort-Object -Unique) -join ', ')
        if (-not $packages) { $packages = 'none' }
        $counts.Add(('{0}: {1} HIGH, {2} CRITICAL (packages: {3})' -f $image, $high, $critical, $packages))
    }
    $result = Complete-FindingStep -Context $Context -Step 'trivy-image' -Finding $findings.ToArray() -Summary ('trivy {0}: {1}' -f $Context.Lock.binaries.trivy.version, ($counts -join ' / ')) -Problem $problems.ToArray()
    if (-not $Context.StrictImages -and $problems.Count -eq 0) {
        # Report only (architect's ruling): the backend and frontend dependencies are not fixed from the infra lane, so the counts
        # are shown as a WARN that never affects the exit code. The per-package list stays in the findings file. A scan that could
        # not run (docker save or trivy error) is still a FAIL; -StrictImages makes any HIGH or CRITICAL a FAIL.
        $reportPath = Join-Path -Path $Context.OutputDir -ChildPath 'trivy-image-findings.json'
        $result.Status = 'WARN'
        $result.Detail = Get-TrivyReportDetail -Finding $findings.ToArray() -Image @($Context.TrivyImage) -ReportPath $reportPath
        $result.Finding = @()
    }
    return $result
}

function Get-TrivyReportDetail {
    <# `api 60 HIGH + 1 CRITICAL; web 54 HIGH + 0 CRITICAL (report only, see <file>)`. The label is the image name without the
       `stellar-blaze-` prefix and the tag. #>
    [CmdletBinding()]
    param([object[]]$Finding = @(), [Parameter(Mandatory)][string[]]$Image, [Parameter(Mandatory)][string]$ReportPath)
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($name in $Image) {
        $label = ($name -split ':')[0] -replace '^stellar-blaze-', ''
        $own = @($Finding | Where-Object { $_.Resource.StartsWith($name + ':') })
        $parts.Add(('{0} {1} HIGH + {2} CRITICAL' -f $label, @($own | Where-Object { $_.Severity -eq 'HIGH' }).Count, @($own | Where-Object { $_.Severity -eq 'CRITICAL' }).Count))
    }
    return ('{0} (report only, see {1})' -f ($parts -join '; '), $ReportPath)
}

function Get-ShellScriptFile {
    <# Every *.sh under infra/, plus the extensionless stubs under infra/scripts/tests/stubs/. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $all = @(Get-RepoFile -Context $Context -RelativeDirectory 'infra' -Recurse)
    $stubRoot = ((Join-Path -Path $Context.RepoRoot -ChildPath 'infra\scripts\tests\stubs') + '\').ToLowerInvariant()
    return @($all | Where-Object { $_.Extension -eq '.sh' -or $_.FullName.ToLowerInvariant().StartsWith($stubRoot) })
}

function Invoke-StepShellcheck {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $shellcheck = Install-LockedTool -Context $Context -Name 'shellcheck'
    $files = @(Get-ShellScriptFile -Context $Context)
    if ($files.Count -eq 0) { Stop-Step -Kind Unavailable -Message 'no shell script under infra/' }
    $relative = @($files | ForEach-Object { (ConvertTo-RepoRelativePath -Path $_.FullName -RepoRoot $Context.RepoRoot) })
    $run = Invoke-Native -FilePath $shellcheck -Argument (@('--format=json1', '--external-sources', '--source-path=SCRIPTDIR', '--shell=bash') + $relative) -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'shellcheck') -TimeoutSeconds 600
    $problems = New-Object System.Collections.Generic.List[string]
    if ($run.ExitCode -notin @(0, 1)) { $problems.Add(('shellcheck exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $findings = @(ConvertFrom-ShellcheckJson -Text $run.StdOut -RepoRoot $Context.RepoRoot)
    return (Complete-FindingStep -Context $Context -Step 'shellcheck' -Finding $findings -Summary ('shellcheck {0} on {1} file(s)' -f $Context.Lock.binaries.shellcheck.version, $files.Count) -Problem $problems.ToArray())
}

function Invoke-StepPsscriptanalyzer {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    [void](Install-LockedPsModule -Context $Context -Name @('PSScriptAnalyzer'))
    $runner = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\validate\psscriptanalyzer-run.ps1'
    $resultPath = Join-Path -Path $Context.OutputDir -ChildPath 'psscriptanalyzer-results.json'
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-Root', (Join-Path -Path $Context.RepoRoot -ChildPath 'infra'), '-OutputPath', $resultPath)
    $run = Invoke-Native -FilePath (Get-HostExecutable) -Argument $arguments -WorkingDirectory $Context.RepoRoot -Environment (Get-ChildHostEnvironment -Context $Context) -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'psscriptanalyzer') -TimeoutSeconds 900
    if (-not (Test-Path -LiteralPath $resultPath)) { return (New-StepResult -Step 'psscriptanalyzer' -Status FAIL -Detail ('PSScriptAnalyzer produced no result file (exit {0}): {1}' -f $run.ExitCode, (Get-TextTail -Text $run.StdErr -Lines 2))) }
    $findings = @(ConvertFrom-AnalyzerJson -Text ([System.IO.File]::ReadAllText($resultPath)) -RepoRoot $Context.RepoRoot)
    $files = @(Get-RepoFile -Context $Context -RelativeDirectory 'infra' -Include @('*.ps1', '*.psm1', '*.psd1') -Recurse).Count
    return (Complete-FindingStep -Context $Context -Step 'psscriptanalyzer' -Finding $findings -Summary ('PSScriptAnalyzer {0} (Warning and Error) on {1} file(s)' -f $Context.Lock.psModules.PSScriptAnalyzer.version, $files))
}

function Find-GitBash {
    <# Git for Windows' bash, never the WSL launcher in System32 that `bash` may resolve to. #>
    [CmdletBinding()]
    param()
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Programs'))) {
        if ($root) { $candidates.Add((Join-Path -Path (Join-Path -Path $root -ChildPath 'Git') -ChildPath 'bin\bash.exe')) }
    }
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    $command = Get-Command -Name 'bash' -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\System32\*' } | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
    return ''
}

function Invoke-StepScriptTest {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    [void](Install-LockedPsModule -Context $Context -Name @('Pester'))
    $parts = New-Object System.Collections.Generic.List[string]
    $problems = New-Object System.Collections.Generic.List[string]
    $environment = Get-ChildHostEnvironment -Context $Context

    $bashSuite = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\scripts\tests\run.sh'
    if (Test-Path -LiteralPath $bashSuite) {
        $bash = Find-GitBash
        if (-not $bash) { $problems.Add('bash tests: Git for Windows bash was not found') }
        else {
            $run = Invoke-Native -FilePath $bash -Argument @('infra/scripts/tests/run.sh') -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'script-tests-bash') -TimeoutSeconds 900
            if ($run.ExitCode -eq 0) { $parts.Add('bash run.sh ok') }
            else { $problems.Add(('bash run.sh exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text ($run.StdOut + ' ' + $run.StdErr) -Lines 3))) }
        }
    }
    else { $parts.Add('bash run.sh absent') }

    $pesterRunner = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\validate\pester-run.ps1'
    $testFiles = @(Get-RepoFile -Context $Context -RelativeDirectory 'infra\scripts\tests\ps' -Include @('*.Tests.ps1'))
    foreach ($testFile in $testFiles) {
        $summaryPath = Join-Path -Path $Context.OutputDir -ChildPath ('pester-' + $testFile.BaseName + '.txt')
        $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $pesterRunner, '-TestPath', $testFile.FullName, '-SummaryPath', $summaryPath)
        $run = Invoke-Native -FilePath (Get-HostExecutable) -Argument $arguments -WorkingDirectory $Context.RepoRoot -Environment $environment -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath ('script-tests-' + $testFile.BaseName)) -TimeoutSeconds 1800
        $summaryText = ''
        if (Test-Path -LiteralPath $summaryPath) { $summaryText = ([System.IO.File]::ReadAllText($summaryPath)).Trim() }
        if ($run.ExitCode -eq 0) { $parts.Add(('{0}: {1}' -f $testFile.BaseName, $summaryText)) }
        else { $problems.Add(('{0} exited {1}: {2}' -f $testFile.Name, $run.ExitCode, $summaryText)) }
    }
    if ($testFiles.Count -eq 0) { $parts.Add('no Pester file yet') }
    $detail = $parts -join '; '
    if ($problems.Count -gt 0) { return (New-StepResult -Step 'script-tests' -Status FAIL -Detail (($problems -join '; ') + ' [passed: ' + $detail + ']')) }
    return (New-StepResult -Step 'script-tests' -Status PASS -Detail $detail)
}

function Invoke-StepRehearsal {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    if (-not $Context.Rehearsal) { return (New-StepResult -Step 'rehearsal' -Status SKIP -Detail 'slow; pass -Rehearsal to run infra/local/rehearse.sh') }
    $script = Join-Path -Path $Context.RepoRoot -ChildPath 'infra\local\rehearse.sh'
    if (-not (Test-Path -LiteralPath $script)) { return (New-StepResult -Step 'rehearsal' -Status SKIP -Detail 'infra/local/rehearse.sh does not exist yet') }
    $bash = Find-GitBash
    if (-not $bash) { Stop-Step -Kind Unavailable -Message 'Git for Windows bash was not found' }
    $run = Invoke-Native -FilePath $bash -Argument @('infra/local/rehearse.sh') -WorkingDirectory $Context.RepoRoot -LogPrefix (Join-Path -Path $Context.OutputDir -ChildPath 'rehearsal') -TimeoutSeconds 3600
    if ($run.ExitCode -ne 0) { return (New-StepResult -Step 'rehearsal' -Status FAIL -Detail ('rehearse.sh exited {0}: {1}' -f $run.ExitCode, (Get-TextTail -Text ($run.StdOut + ' ' + $run.StdErr) -Lines 3))) }
    return (New-StepResult -Step 'rehearsal' -Status PASS -Detail 'rehearse.sh ok')
}

# ---------------------------------------------------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------------------------------------------------

function Get-StepFunctionName {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Step)
    $map = @{
        'bicep' = 'Invoke-StepBicep'; 'psrule' = 'Invoke-StepPsrule'; 'checkov' = 'Invoke-StepCheckov'
        'actionlint' = 'Invoke-StepActionlint'; 'act' = 'Invoke-StepAct'; 'hadolint' = 'Invoke-StepHadolint'
        'trivy-image' = 'Invoke-StepTrivyImage'; 'shellcheck' = 'Invoke-StepShellcheck'
        'psscriptanalyzer' = 'Invoke-StepPsscriptanalyzer'; 'script-tests' = 'Invoke-StepScriptTest'; 'rehearsal' = 'Invoke-StepRehearsal'
    }
    return $map[$Step]
}

function Invoke-ValidationStep {
    <# Runs one step. An Integrity error or any unexpected error is FAIL; an Unavailable error is SKIP with its reason. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Step)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = & (Get-StepFunctionName -Step $Step) -Context $Context
    }
    catch {
        $kind = Get-ErrorKind -ErrorRecord $_
        $message = ($_.Exception.Message -replace '\s+', ' ').Trim()
        if ($kind -eq 'Unavailable') { $result = New-StepResult -Step $Step -Status SKIP -Detail $message }
        elseif ($kind -eq 'Integrity') { $result = New-StepResult -Step $Step -Status FAIL -Detail ('integrity check failed: ' + $message) }
        else { $result = New-StepResult -Step $Step -Status FAIL -Detail ('unexpected error: ' + $message) }
    }
    $watch.Stop()
    $result.Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    return $result
}

function Install-StepTool {
    <# -InstallOnly: installs (verifies) everything the selected steps need. Returns one PASS/FAIL/SKIP result per step. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string[]]$Step)
    $needs = @{
        'bicep' = @{ Binary = @('bicep') }
        'psrule' = @{ Binary = @('bicep'); Module = @('PSRule', 'PSRule.Rules.Azure') }
        'checkov' = @{ Image = @('checkov') }
        'actionlint' = @{ Binary = @('actionlint', 'shellcheck') }
        'act' = @{ Binary = @('act') }
        'hadolint' = @{ Binary = @('hadolint') }
        'trivy-image' = @{ Binary = @('trivy') }
        'shellcheck' = @{ Binary = @('shellcheck') }
        'psscriptanalyzer' = @{ Module = @('PSScriptAnalyzer') }
        'script-tests' = @{ Module = @('Pester') }
        'rehearsal' = @{}
    }
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($name in $Step) {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $need = $needs[$name]
            foreach ($binary in @($need['Binary'])) { if ($binary) { [void](Install-LockedTool -Context $Context -Name $binary) } }
            if ($need['Module']) { [void](Install-LockedPsModule -Context $Context -Name $need['Module']) }
            foreach ($image in @($need['Image'])) { if ($image) { [void](Install-LockedImage -Context $Context -Name $image) } }
            $result = New-StepResult -Step $name -Status PASS -Detail 'tools installed and verified against the lock'
        }
        catch {
            $kind = Get-ErrorKind -ErrorRecord $_
            $message = ($_.Exception.Message -replace '\s+', ' ').Trim()
            if ($kind -eq 'Unavailable') { $result = New-StepResult -Step $name -Status SKIP -Detail $message }
            else { $result = New-StepResult -Step $name -Status FAIL -Detail $message }
        }
        $result.Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
        $results.Add($result)
    }
    return $results.ToArray()
}
