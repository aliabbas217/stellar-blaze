# ADR 0063: Lighthouse CI launches Chrome with `--no-sandbox` on the ephemeral GitHub runner only; no sysctl edit

- **Status:** Accepted by the architect (default; Ali informed 2026-11-14 and can overrule)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Settles F2 plan decision D5 and the F1 "CI decisions" open item.
- **Evidence:** F1 summary "Awaiting the user" ("Lighthouse on ubuntu-24.04 may need a sysctl step or `--no-sandbox`. The implementer's sysctl edit was denied by the permission classifier, so neither is in the workflow"); F2 plan D5 and Task 25 Step 3 (`chromeFlags: --no-sandbox`); Chromium docs, "AppArmor User Namespace Restrictions vs. Chromium Developer Builds" (read 2026-11-14: the sysctl is "the easiest way" but "disables a useful Ubuntu security feature"; `--no-sandbox` "disables critical security features of Chromium and should never be used when browsing the open web"); search 2026-11-14 for the failure on GitHub-hosted runners found no documented case.

## Context
Ubuntu 23.10 and later restrict unprivileged user namespaces through AppArmor (`kernel.apparmor_restrict_unprivileged_userns`). A Chrome without a matching AppArmor profile then fails to create its sandbox ("No usable sandbox"). The GitHub-hosted `ubuntu-24.04` runner is that OS; the F1 implementer expected Lighthouse CI to need a workaround and had never run it in CI. The Lighthouse job loads only our own build on localhost: fonts are self-hosted, the CSP is `connect-src 'self'`, and nothing is fetched from the open web.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` in the workflow | Relaxes a host-wide kernel control for every later step and third-party action in the job; the Chromium docs call it disabling "a useful Ubuntu security feature"; the F1 implementer's attempt to add it was denied by the permission classifier, which we treat as a signal and do not route around | Rejected |
| An AppArmor profile that lets the one Chrome binary use user namespaces (or the setuid sandbox helper) | The Chromium docs' scoped alternatives; not evaluated on the hosted image within the freeze window | Deferred: the preferred upgrade |
| `--no-sandbox` for the Lighthouse Chrome only, on the CI runner (chosen) | Per-process; a throwaway VM; a page set we build ourselves; no open-web browsing | Accepted |

## Decision
`--no-sandbox` is passed to the Lighthouse Chrome **in CI only**. No sysctl change, no AppArmor edit, no other job affected. The flag is not used for local runs and is not added to the Playwright e2e step, which launches its own Chromium.

## Consequences
- **Mechanism, for the Task 25 owner:** the plan puts the flag in `lighthouserc.json`, which also applies to local `pnpm exec lhci autorun`. To honour "CI only", set it where only CI reads it (the CI step's command line or a CI-conditional config). Not verified here which form `lhci` accepts.
- **The need is unconfirmed:** the failure was predicted, not observed on a hosted runner. If the first CI run launches Chrome with the sandbox, remove the flag and amend this ADR.
- **Cost of being wrong:** a compromised page under test could escape the renderer, inside a disposable runner. The `frontend` job in F1's `.github/workflows/ci.yml` (read 2026-11-14) has `permissions: contents: read` and references no secret; the decision holds only while that stays true. A wrongly omitted flag costs a red CI job, not a risk.

## Revisit trigger
The first CI run shows the sandbox works (drop the flag); the Lighthouse job gains a secret or loads a third-party origin (the decision no longer holds); the scoped AppArmor profile is validated on the hosted image (adopt it).

## Links
[F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md) D5, Task 25 · [ADR 0003](0003-frontend-single-nextjs-app-pwa.md) · [parking lot](../parking-lot.md) · Chromium: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
