# ADR 0080: Demo role entries are a label, not sign-in; the production plan; worker accounts rejected

- **Status:** Proposed. The owner approved the redesign direction and the role-entry prototypes, but did not answer the access-model question explicitly. Owner confirmation pending.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude) proposes; Ali (owner) confirms
- **Supersedes / superseded by:** none. Extends [ADR 0062](0062-public-demo-access-model.md) (the shared demo token and the BFF allow-list stay as they are) and [ADR 0054](0054-governance-refusal-and-hash-chained-audit.md).
- **Evidence:** `03-journeys-and-onboarding.md` §1, §4.1, §7; slice S7, `51257ce` (merge `56786a3`); `frontend/src/lib/demo-role.ts`, `components/shell/RoleEntry.tsx`; `backend/src/stellar_blaze/api/auth.py` (a token's role must be `employer`).

## Context
"Is there auth?" had no visible answer. A sign-in form that accepts anything would pretend to be authentication.

## Decision
1. **Role entries.** `/supervisor/enter` and `/hse/enter` are one-screen cards with no field of any kind and one button ("Continue as the demo crew lead" or "... safety officer"). The sentence **"Demo access. Anyone can enter."** is required, always visible, Tier 1; one more sentence says what production would be.
2. **The role is a label.** `lib/demo-role.ts` stores `crew-lead` or `officer` in `sessionStorage` (`sb-demo-role`). No request reads it, no route is gated by it, deep links are never blocked, and storage that throws falls back to page memory. A role badge with "Switch role" shows on the supervisor and safety frames.
3. **The BFF allow-list of ADR 0062 stays the only gate.**
4. **Production plan (proposed, not built, not verified):** the employer sends an invitation link (signed, single-use, expiring) and its staff sign in with their own organisation's identity; the API gains roles beyond `employer` and per-user tokens, so the audit row names a person. No vendor is chosen.
5. **Worker accounts are rejected.** Workers never need an account; the phone pins a site and crew on the device. An account would create the identifier that ADR 0054 says does not exist, add a health-adjacent record the data-protection position has not been reviewed for, add friction on shared and prepaid phones, and hand an employer a lever to ask for per-person data. No feature needs identity: the personal level is computed on the phone.

## Options rejected
As is (no visible roles); real employer sign-in before submission (needs an email or identity service, token issuance, a session store and a reset story; it cannot land by the freeze).

## Consequences
- **Cost of being wrong:** a reviewer reads the role entry as authentication. The on-screen sentence is the mitigation. If the owner prefers no entries, removing two routes and the badge is a small change.

## Revisit trigger
A pilot agrees with an employer; any non-synthetic data (0062's trigger); a pilot needs verified attendance and counsel agrees (then an opt-in pseudonymous account, by a new ADR).

## Links
[ADR 0062](0062-public-demo-access-model.md) · [0054](0054-governance-refusal-and-hash-chained-audit.md) · [0082](0082-deferrals-after-the-redesign.md) · [03-journeys](../design/redesign-2026-11-17/03-journeys-and-onboarding.md)
