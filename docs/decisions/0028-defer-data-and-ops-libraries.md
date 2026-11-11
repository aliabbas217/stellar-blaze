# ADR 0028: Defer TimescaleDB, PostGIS, MLflow and other data/ops libraries (granian, hishel/cachetools, pandera)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Consolidates rejections already implied by accepted ADR 0001 ("No extensions"), ADR 0007 (MLflow rejected) and ADR 0008 (stack doc §7 pins are authoritative); one heading per item
- **Evidence:** `docs/research/2026-11-11-backend-ml-stack.md` §1 finding 8, §3 (persistence), §4, §5 items 1, 3-6; `docs/research/2026-11-11-deployment-options.md` §0 ("Possibly TimescaleDB/PostGIS" row), §3.1

## Context
The analysis volume is about 0.47 M rows per variable set per model (about 1.4 M across IFS/AIFS/GFS), which Parquet + DuckDB handle in-process; station matching is nearest-of-10 points (stack doc §3). Postgres holds only app state. Fewer than 100 training runs by one person.

## Items
| Item | Evidence | Revisit trigger |
|---|---|---|
| **TimescaleDB** (2.31.0) | Not needed at this volume; `tsl/` code under the Timescale License; available on Azure PG Flexible if needed (deployment §3.1) | Hot time-series above about 50 M rows |
| **PostGIS** | No polygons; GPL-2.0 | Site polygons |
| **MLflow** (skinny or full, 3.18.0) | +18 / +48 packages and a server for under 100 runs; file store "to be deprecated soon" (stack §1 finding 8); artefacts + model card suffice (ADR 0007) | More than one person trains models |
| **granian** 2.8.7 | uvicorn is sufficient | p99 latency under load testing exceeds the target |
| **hishel** 2.0.0 / **cachetools** 8.0.0 | The raw-response store already caches upstream calls; hishel was a six-day-old major | Adapters show repeated identical upstream calls |
| **pandera** 0.36.0 | One data producer | A second producer feeds the Parquet store |

## Options considered
| Option | Verdict |
|---|---|
| Adopt now "for production readiness" | Rejected: dependencies and a service with no measured need (ADR 0002 minimalism) |
| Defer each with a measurable trigger (chosen) | Accepted |

## Decision
None of the six is added for the submission.

## Consequences
- **Cost of being wrong:** a reviewer may read "no experiment tracker" as immaturity; the manifest + model card + git SHA trail answers that. Each library can be added in under a day if its trigger fires.

## Revisit trigger
Per item above.

## Links
[ADR 0001](0001-hosting-azure-uae-north.md) · [ADR 0002](0002-infra-minimalism-and-ports.md) · [ADR 0007](0007-ml-quantile-corrector-conformal.md) · [ADR 0008](0008-backend-stack.md)
