# ADR 0086: The demo runs in Azure France Central; the design target stays UAE North

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18). The step itself, "another Azure region", was accepted by Ali in [ADR 0001](0001-hosting-azure-uae-north.md) (2026-11-11).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner) ran the deployment; the architect (Claude)
- **Supersedes / superseded by:** none. Amends [ADR 0072](0072-cheap-by-default-demo-hosting.md) (region and prices) and [ADR 0001](0001-hosting-azure-uae-north.md) (ladder step 1 taken).
- **Evidence:** `docs/submission/limitations.md` ("the free-trial subscription we used could not create the database in UAE North"); amendments of 2026-11-17 to [ADR 0034](0034-demo-strategy.md) and [0062](0062-public-demo-access-model.md) ("the first live deploy (France Central ...)"); `infra/README.md` §12 step 1; `1bcc769`, `df5aea0`. Reported by the controller and **not recorded in the repo**: which other regions refused, that the Free Trial allows one Container Apps environment per subscription, and that the old UAE North resource group still exists.

## Context
UAE North was refused for the Free Trial subscription: PostgreSQL could not be created there. The ladder of ADR 0001 says to use the same Bicep in another region.

## Decision
1. **The demo runs in France Central.** The Bicep `location` parameter is the only change; the design target, the documents and the pricing basis stay UAE North.
2. **Never claim in-UAE hosting for the demo.** Allowed wording: "Hosted in France Central for the demo; designed for UAE North." The demo holds made-up data only. This is ADR 0001's own consequence: the in-UAE claim is then a design property.
3. **One Container Apps environment per subscription** on the Free Trial (controller report): a failed attempt must be cleaned up before a retry.
4. **The old UAE North resource group still exists** (controller report). No action without the owner.
5. Smoke check S6 compares with the resource group's own region (`1bcc769`), so it can no longer catch an accidental wrong region.

## Consequences
- The cost table in `infra/README.md` and [ADR 0072](0072-cheap-by-default-demo-hosting.md) uses UAE North retail prices. France Central was not re-priced, and whether the "Environment Management Hour" meter applies there was not checked.
- Round-trip time from the UAE to France was not measured.
- **Cost of being wrong:** a judge reads "Azure UAE North" in an older document and assumes the demo is in the UAE. The limitations text, the deck, the form text and the landing's last chapter say France Central; any other document that says UAE North for the demo is wrong.

## Revisit trigger
The owner has a subscription that can create PostgreSQL in UAE North; GITEX preparation (7 to 11 Dec); a budget decision; the old resource group is checked in Cost Analysis and deleted or kept.

## Links
[ADR 0001](0001-hosting-azure-uae-north.md) · [0072](0072-cheap-by-default-demo-hosting.md) · [0073](0073-hosting-design-calls-from-the-i1-lane.md) · [0087](0087-continuous-deployment-from-main.md)
