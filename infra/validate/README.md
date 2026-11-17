# infra/validate: offline validators for the infra

One command, no Azure and no account needed:

```powershell
.\infra\scripts\validate-local.ps1                       # every step; PASS / FAIL / SKIP / WARN per step, exit 1 on any FAIL
.\infra\scripts\validate-local.ps1 -Only bicep,psrule    # a subset (-Skip removes steps)
.\infra\scripts\validate-local.ps1 -InstallOnly          # install and verify the pinned tools, then stop
.\infra\scripts\validate-local.ps1 -Rehearsal            # also the slow infra/local/rehearse.sh
.\infra\scripts\validate-local.ps1 -StrictImages         # any HIGH or CRITICAL in the scanned images is a FAIL
```

`WARN` is informational: it is not a failure and does not change the exit code (only `FAIL` does; `SKIP` and `WARN` never do).
The only WARN today is `trivy-image`: by the architect's ruling the image scan is report-only, because the backend and
frontend dependencies are not fixed from the infra lane. It prints
`WARN trivy-image api <n> HIGH + <n> CRITICAL; web <n> HIGH + <n> CRITICAL (report only, see <file>)`; the per-package list is
in `<OutputDir>\trivy-image-findings.json`. A scan that cannot run (docker save or trivy error) is still a FAIL.
With `-StrictImages` any HIGH or CRITICAL is a FAIL again, and `accepted-risks.json` entries for `trivy-image` apply.

Steps: `bicep`, `psrule`, `checkov`, `actionlint`, `act`, `hadolint`, `trivy-image`, `shellcheck`, `psscriptanalyzer`,
`script-tests`, `rehearsal`. Tools are installed on first use into `-ToolsDir` (default
`%LOCALAPPDATA%\stellar-blaze-i1\tools`, never the repo); full tool output goes to `-OutputDir` (a new temp folder, printed
at the start). Windows PowerShell 5.1 and PowerShell 7; the `checkov` and `trivy-image` steps need Docker and `act` needs it
too (they are SKIPPED with the reason when it is not running).

## Files

| File | Purpose |
|---|---|
| `tools.lock.json` | Every tool: version, official URL, sha256 / SHA512 / image digest, how the checksum was verified |
| `accepted-risks.json` | The only way a finding stops failing its step (see below) |
| `ps-rule.yaml` | PSRule for Azure options |
| `psrule-run.ps1`, `psscriptanalyzer-run.ps1`, `pester-run.ps1` | Child processes of the steps; not run by hand |

Logic lives in `infra/scripts/validate-local.lib.ps1`; its Pester tests are `infra/scripts/tests/ps/ValidateLocal.Tests.ps1`.

## Rules

- **Pinned and verified.** A download is allowed only from `github.com` or `www.powershellgallery.com` over https and is kept
  only when its hash equals the lock's; an installed binary is re-hashed on every run. A mismatch FAILS the step and installs
  nothing. Docker images are pinned by digest and run with `--network none`.
- **Bumping a tool.** Look the new version up on the project's own release page (GitHub API `releases/latest` and its asset
  `digest`; the release checksums file where there is one; the PowerShell Gallery feed `PackageHash` for modules; the Docker
  Hub tag digest for images), change `version`, `url`, the hash and (for archives) `exeSha256` together, and re-run.
- **Findings.** A finding fails its step unless `accepted-risks.json` has an entry with the same `tool`, `ruleId` and
  `resource` (exact match, case-sensitive). Every entry needs a `reason` of at least 20 characters, a `date` (`yyyy-MM-dd`,
  not in the future) and may carry a `reference`. A wildcard in `ruleId` or `resource`, an unknown property, a duplicate or
  an unknown tool makes the whole file invalid, and the run stops with `FAIL config`. There is no switch that suppresses
  findings in general. An entry that matches no finding any more is listed as a note: remove it.
- **Resource keys** (copy them from `<OutputDir>\<step>-findings.json`): `bicep`, `actionlint`, `hadolint`, `shellcheck`,
  `psscriptanalyzer` use the repo-relative file; `psrule` uses `<resource type>/<resource name>` (names that carry a hash come
  from PSRule's fixed fake subscription and stay stable); `checkov` uses `<compiled file>#<checkov resource id>`;
  `trivy-image` uses `<image>:<package>` with the CVE as the rule id.
- **Why Checkov scans the compiled templates.** Checkov's own Bicep parser (pycep) cannot read `import { ... } from` or
  `export type`, so its `bicep` framework skips most of `infra/bicep` (its summary shows `parsing_errors`). The Bicep CLI
  compiles the templates and Checkov's `arm` framework scans the JSON; a non-zero `parsing_errors` FAILS the step.
