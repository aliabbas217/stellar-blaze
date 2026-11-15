<#
.SYNOPSIS
    HTTP smoke test of a deployed Stellar Blaze demo, through the public web URL only. Native port of smoke-http.sh.

.DESCRIPTION
    Takes only the web URL and never calls the api directly (the api has internal ingress; the web BFF is the way in, so
    these checks also prove the web to api path). Every request uses curl.exe (built into Windows 10 and 11), so the
    semantics equal the bash script; Invoke-WebRequest is never used. Prints PASS, FAIL or SKIP with the check id, and
    exits 1 when any check FAILs.

      H1  GET /api/healthz is 200 with status ok and a version
      H2  GET /api/v1/health/ready through the BFF is 200 with status ok
      H3  Stop work: POST /api/v1/crews/crew-b/stops 201, DELETE the stop 204 inside the 10 s undo window, and the
          crew timeline then holds no "crew_level":"red"
      H4  the replay clock: the stop's started_at plus 4 hours is between 10:00 and 17:30 Asia/Dubai
      H5  over https, the http:// URL does not answer 200
      H7  a forged Authorization: Bearer x on POST /api/v1/crews/crew-z/stops (a route off the BFF allow-list) is answered
          401, 403 or 404, never 201
      H6  LAST (it drains the demo's general rate-limit bucket for about a minute): 30 sequential GET
          /api/v1/crews/crew-b/day-plan requests, request i with X-Forwarded-For: 203.0.113.<i>; PASS iff a 429 with
          Retry-After appears at request 30 or earlier (a forged header must not give each request its own bucket)

    The ids and the order (H1 H2 H3 H4 H5 H7 H6) are those of infra/scripts/smoke-http.sh, which this script ports.

.PARAMETER BaseUrl
    The web URL, for example https://web.<environment>.<region>.azurecontainerapps.io

.PARAMETER Wait
    After the checks, sleep 62 s so that the rate-limit window H6 drained is clear again (same as smoke-http.sh --wait).

.PARAMETER WaitReady
    Before the checks, wait (up to -WaitSeconds) until /api/healthz answers 200, for a freshly deployed web app.

.PARAMETER NoRevoke
    Pass --ssl-no-revoke to curl.exe. Only for networks where Windows cannot reach the certificate revocation server.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'New-HttpResult only builds an in-memory result object.')]
[CmdletBinding()]
param(
    [string]$BaseUrl,
    [switch]$Wait,
    [switch]$WaitReady,
    [switch]$NoRevoke,
    [int]$WaitSeconds = 300
)

$ErrorActionPreference = 'Stop'
$script:CurlNoRevoke = [bool]$NoRevoke

function Invoke-Curl {
    <# One request with curl.exe. Status is 0 when curl itself failed (refused, timeout, TLS); the reason is in Error. #>
    [CmdletBinding()]
    param(
        [string]$Method = 'GET',
        [Parameter(Mandatory)][string]$Url,
        [string[]]$Header = @(),
        [string]$Body = '',
        [int]$MaxTime = 20
    )
    $bodyFile = [System.IO.Path]::GetTempFileName()
    $headerFile = [System.IO.Path]::GetTempFileName()
    $requestFile = ''
    try {
        $curlArgs = New-Object System.Collections.Generic.List[string]
        foreach ($item in @('--silent', '--show-error', '--max-time', "$MaxTime", '--output', $bodyFile, '--dump-header', $headerFile, '--write-out', '%{http_code}', '--request', $Method)) { $curlArgs.Add($item) }
        if ($script:CurlNoRevoke) { $curlArgs.Add('--ssl-no-revoke') }
        foreach ($line in $Header) { $curlArgs.Add('--header'); $curlArgs.Add($line) }
        if ($Body) {
            # The body goes through a file: PowerShell 5.1 strips double quotes from native arguments.
            $requestFile = [System.IO.Path]::GetTempFileName()
            [System.IO.File]::WriteAllText($requestFile, $Body, (New-Object System.Text.UTF8Encoding($false)))
            $curlArgs.Add('--header'); $curlArgs.Add('Content-Type: application/json')
            $curlArgs.Add('--data-binary'); $curlArgs.Add("@$requestFile")
        }
        $curlArgs.Add($Url)
        $argumentArray = $curlArgs.ToArray()
        # Native stderr becomes a terminating error in Windows PowerShell 5.1 only under 'Stop'; merge it, then split by type.
        $ErrorActionPreference = 'Continue'
        $everything = @(& curl.exe @argumentArray 2>&1)
        $exitCode = $LASTEXITCODE
        $written = @($everything | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
        $errorText = (@($everything | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString().Trim() }) -join ' ')
        $status = 0
        if (-not [int]::TryParse((@($written) -join '').Trim(), [ref]$status)) { $status = 0 }
        return [pscustomobject]@{
            Status   = $status
            Body     = [System.IO.File]::ReadAllText($bodyFile)
            Headers  = [System.IO.File]::ReadAllText($headerFile)
            ExitCode = $exitCode
            Error    = $errorText
        }
    }
    finally {
        foreach ($file in @($bodyFile, $headerFile, $requestFile)) {
            if ($file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Get-HeaderValue {
    [CmdletBinding()]
    param([string]$RawHeaders, [Parameter(Mandatory)][string]$Name)
    $pattern = '(?im)^' + [regex]::Escape($Name) + ':[ \t]*(.*?)[ \t]*\r?$'
    $found = [regex]::Matches($RawHeaders, $pattern)
    if ($found.Count -eq 0) { return '' }
    return $found[$found.Count - 1].Groups[1].Value
}

function New-HttpResult {
    [CmdletBinding()]
    param([ValidateSet('PASS', 'FAIL', 'SKIP')][string]$Status, [string]$Id, [string]$Subject, [string]$StartedAt = '')
    return [pscustomobject]@{ Status = $Status; Id = $Id; Subject = $Subject; StartedAt = $StartedAt }
}

function Get-Failure {
    [CmdletBinding()]
    param($Response)
    if ($Response.Status -eq 0) { return "no HTTP answer (curl exit $($Response.ExitCode): $($Response.Error))" }
    return "HTTP $($Response.Status)"
}

function Test-H1 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base)
    $response = Invoke-Curl -Url "$Base/api/healthz"
    if ($response.Status -ne 200) { return New-HttpResult -Status FAIL -Id 'H1' -Subject "GET /api/healthz: $(Get-Failure -Response $response), expected 200" }
    try { $json = $response.Body | ConvertFrom-Json } catch { return New-HttpResult -Status FAIL -Id 'H1' -Subject 'GET /api/healthz: the body is not JSON' }
    $health = [string]$json.status
    $version = ''
    if ($null -ne $json.PSObject.Properties['version']) { $version = [string]$json.version }
    if ($health -ne 'ok') { return New-HttpResult -Status FAIL -Id 'H1' -Subject "GET /api/healthz: status is '$health', expected ok" }
    if ([string]::IsNullOrWhiteSpace($version)) { return New-HttpResult -Status FAIL -Id 'H1' -Subject 'GET /api/healthz: no version in the body' }
    return New-HttpResult -Status PASS -Id 'H1' -Subject "GET /api/healthz 200, status ok, version $version"
}

function Test-H2 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base)
    $response = Invoke-Curl -Url "$Base/api/v1/health/ready"
    if ($response.Status -ne 200) { return New-HttpResult -Status FAIL -Id 'H2' -Subject "GET /api/v1/health/ready through the BFF: $(Get-Failure -Response $response), expected 200 (the web cannot reach a ready api)" }
    try { $json = $response.Body | ConvertFrom-Json } catch { return New-HttpResult -Status FAIL -Id 'H2' -Subject 'GET /api/v1/health/ready: the body is not JSON' }
    if ([string]$json.status -ne 'ok') { return New-HttpResult -Status FAIL -Id 'H2' -Subject "GET /api/v1/health/ready: status is '$($json.status)', expected ok" }
    return New-HttpResult -Status PASS -Id 'H2' -Subject 'GET /api/v1/health/ready through the BFF 200, status ok (web to api works)'
}

function Test-H3 {
    <# Stop work and undo it. Returns StartedAt (the api's replay clock reading) for H4. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base)
    $subject = 'Stop work: POST stops, DELETE inside 10 s, timeline has no red'
    $created = Invoke-Curl -Method POST -Url "$Base/api/v1/crews/crew-b/stops" -Body '{"reason_code":"other"}'
    if ($created.Status -ne 201) { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (POST: $(Get-Failure -Response $created), expected 201)" }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $idMatch = [regex]::Match($created.Body, '"id"\s*:\s*"([^"]+)"')
    $startedMatch = [regex]::Match($created.Body, '"started_at"\s*:\s*"([^"]+)"')
    if (-not $idMatch.Success) { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (the 201 body has no stop id)" }
    $startedAt = ''
    if ($startedMatch.Success) { $startedAt = $startedMatch.Groups[1].Value }
    $stopId = $idMatch.Groups[1].Value
    $deleted = Invoke-Curl -Method DELETE -Url "$Base/api/v1/crews/crew-b/stops/$stopId"
    $elapsed = $clock.Elapsed.TotalSeconds
    if ($deleted.Status -ne 204) { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (DELETE: $(Get-Failure -Response $deleted), expected 204; $([math]::Round($elapsed, 1)) s after the POST)" -StartedAt $startedAt }
    if ($elapsed -gt 10) { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (the DELETE answered after $([math]::Round($elapsed, 1)) s, outside the 10 s undo window)" -StartedAt $startedAt }
    $timeline = Invoke-Curl -Url "$Base/api/v1/crews/crew-b/timeline"
    if ($timeline.Status -ne 200) { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (timeline: $(Get-Failure -Response $timeline), expected 200)" -StartedAt $startedAt }
    if ($timeline.Body -match '"crew_level"\s*:\s*"red"') { return New-HttpResult -Status FAIL -Id 'H3' -Subject "$subject (the timeline still has crew_level red after the stop was cleared)" -StartedAt $startedAt }
    return New-HttpResult -Status PASS -Id 'H3' -Subject "Stop work: stop $stopId created 201, cleared 204 after $([math]::Round($elapsed, 1)) s, timeline has no red" -StartedAt $startedAt
}

function Test-H4 {
    [CmdletBinding()]
    param([string]$StartedAt)
    $subject = 'replay clock inside 10:00-17:30 Asia/Dubai'
    if ([string]::IsNullOrWhiteSpace($StartedAt)) { return New-HttpResult -Status FAIL -Id 'H4' -Subject "$subject (no started_at: H3 did not create a stop)" }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($StartedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) {
        return New-HttpResult -Status FAIL -Id 'H4' -Subject "$subject (started_at '$StartedAt' is not a date)"
    }
    # Asia/Dubai is UTC+4 all year, no daylight saving.
    $dubai = $parsed.UtcDateTime.AddHours(4)
    $time = $dubai.TimeOfDay
    $label = $dubai.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
    if ($time -ge [TimeSpan]::FromHours(10) -and $time -le [TimeSpan]::FromMinutes(17 * 60 + 30)) {
        return New-HttpResult -Status PASS -Id 'H4' -Subject "replay clock reads $label Asia/Dubai (inside 10:00-17:30)"
    }
    return New-HttpResult -Status FAIL -Id 'H4' -Subject "replay clock reads $label Asia/Dubai, outside 10:00-17:30: run deploy-local.ps1 -Action ResetClock (or infra/scripts/restart-replay-clock.sh)"
}

function Test-H5 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base)
    $uri = [uri]$Base
    if ($uri.Scheme -ne 'https') { return New-HttpResult -Status SKIP -Id 'H5' -Subject 'plain http must not answer 200: skipped, the base URL is not https' }
    $response = Invoke-Curl -Url "http://$($uri.Host)/api/healthz" -MaxTime 15
    if ($response.Status -eq 200) { return New-HttpResult -Status FAIL -Id 'H5' -Subject "http://$($uri.Host)/api/healthz answered 200 over plain http; it must redirect or refuse" }
    if ($response.Status -eq 0) { return New-HttpResult -Status PASS -Id 'H5' -Subject "plain http is not served: http://$($uri.Host)/api/healthz gets no answer (refused)" }
    return New-HttpResult -Status PASS -Id 'H5' -Subject "plain http is not served: http://$($uri.Host)/api/healthz answered $($response.Status)"
}

function Test-H7 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base)
    $subject = 'forged Bearer on POST /api/v1/crews/crew-z/stops is refused (401, 403 or 404)'
    $response = Invoke-Curl -Method POST -Url "$Base/api/v1/crews/crew-z/stops" -Header @('Authorization: Bearer x') -Body '{"reason_code":"other"}'
    if ($response.Status -eq 201) { return New-HttpResult -Status FAIL -Id 'H7' -Subject "$subject (answered 201: a forged token was accepted)" }
    if ($response.Status -eq 0) { return New-HttpResult -Status FAIL -Id 'H7' -Subject "$subject (inconclusive: $(Get-Failure -Response $response))" }
    if (@(401, 403, 404) -notcontains $response.Status) { return New-HttpResult -Status FAIL -Id 'H7' -Subject "$subject (answered $($response.Status))" }
    return New-HttpResult -Status PASS -Id 'H7' -Subject "a forged Authorization header on a route off the allow-list is refused: $($response.Status)"
}

function Test-H6 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base, [int]$Requests = 30)
    $subject = "forged X-Forwarded-For: a 429 with Retry-After within $Requests requests"
    $seen = @{}
    for ($i = 1; $i -le $Requests; $i++) {
        $response = Invoke-Curl -Url "$Base/api/v1/crews/crew-b/day-plan" -Header @("X-Forwarded-For: 203.0.113.$i") -MaxTime 20
        $key = "$($response.Status)"
        if ($seen.ContainsKey($key)) { $seen[$key]++ } else { $seen[$key] = 1 }
        # No answer at all is not a rate-limit verdict, and 30 timeouts in a row would take minutes: stop at the first.
        if ($response.Status -eq 0) { return New-HttpResult -Status FAIL -Id 'H6' -Subject "$subject (request $i got $(Get-Failure -Response $response))" }
        if ($response.Status -eq 429) {
            $retry = Get-HeaderValue -RawHeaders $response.Headers -Name 'Retry-After'
            if ([string]::IsNullOrWhiteSpace($retry)) { return New-HttpResult -Status FAIL -Id 'H6' -Subject "$subject (request $i answered 429 without Retry-After)" }
            return New-HttpResult -Status PASS -Id 'H6' -Subject "forged X-Forwarded-For did not escape the rate limit: 429 with Retry-After $retry at request $i"
        }
    }
    $summary = ($seen.Keys | Sort-Object | ForEach-Object { "$_ x$($seen[$_])" }) -join ', '
    return New-HttpResult -Status FAIL -Id 'H6' -Subject "$subject (no 429 in $Requests requests: $summary; a client can dodge the limit by forging X-Forwarded-For, check TRUSTED_PROXY_HOPS)"
}

function Wait-DemoWeb {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base, [int]$TimeoutSeconds = 300, [int]$IntervalSeconds = 5)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        $response = Invoke-Curl -Url "$Base/api/healthz" -MaxTime 10
        if ($response.Status -eq 200) { return $true }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Seconds $IntervalSeconds
    }
}

# Dot-sourcing (the tests) loads the functions and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

Set-StrictMode -Version 2.0
if ([string]::IsNullOrWhiteSpace($BaseUrl) -or $BaseUrl -notmatch '^https?://') {
    [Console]::Error.WriteLine('Usage: Test-DemoHttp.ps1 -BaseUrl https://<web fqdn> [-WaitReady] [-Wait] [-NoRevoke]')
    exit 2
}
$base = $BaseUrl.TrimEnd('/')
$failed = 0
if ($WaitReady) {
    if (-not (Wait-DemoWeb -Base $base -TimeoutSeconds $WaitSeconds)) {
        Write-Output "FAIL H0 $base/api/healthz did not answer 200 within $WaitSeconds s"
        Write-Output 'SMOKE FAILED: 1 check(s) failed'
        exit 1
    }
}
# Each result is printed as soon as its check ends (H6 alone makes up to 30 requests).
function Publish-Result {
    param($Result)
    Write-Output ('{0} {1} {2}' -f $Result.Status, $Result.Id, $Result.Subject)
    if ($Result.Status -eq 'FAIL') { $script:failed++ }
}
Publish-Result -Result (Test-H1 -Base $base)
Publish-Result -Result (Test-H2 -Base $base)
$stopResult = Test-H3 -Base $base
Publish-Result -Result $stopResult
Publish-Result -Result (Test-H4 -StartedAt $stopResult.StartedAt)
Publish-Result -Result (Test-H5 -Base $base)
Publish-Result -Result (Test-H7 -Base $base)
# Last on purpose: it drains the demo's general rate-limit bucket for about a minute.
Write-Output 'NOTE H6 now drains the demo general rate-limit bucket for 61 s: day-plan reads, sign-offs and data requests answer 429 until then (Stop work is unaffected).'
Publish-Result -Result (Test-H6 -Base $base)
if ($Wait) {
    Write-Output 'NOTE waiting 62 s for the rate-limit window to clear'
    Start-Sleep -Seconds 62
}
if ($failed -gt 0) {
    Write-Output ('SMOKE FAILED: {0} check(s) failed' -f $failed)
    exit 1
}
Write-Output 'SMOKE OK'
exit 0
