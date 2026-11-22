# Fresh repair task qualification — 2026-09-20

The three fresh contracts in [the revised protocol](repair-discovery-protocol.md) passed offline qualification using the real `CentralHypothesisRunner`. No provider was contacted.

| Contract | Reference public / hidden | Combined bugs public / hidden | Individual defects detected by hidden tests | Individual defects detected by public tests |
| --- | --- | --- | --- | --- |
| Nested atomic table | Pass / pass | Fail / fail | 3 of 3 | 1 of 3 |
| Single-flight invalidation | Pass / pass | Fail / fail | 3 of 3 | 1 of 3 |
| Reentrant turn scheduler | Pass / pass | Fail / fail | 3 of 3 | 1 of 3 |

All 30 executions completed with their required outcomes. Public coverage is intentionally incomplete and recorded; hidden-only residual failures cannot trigger feedback in the proposed live protocol. Independent single-defect checks address the earlier equivalent-mutation problem, but do not establish comprehensive test coverage or model difficulty.

The successful frozen evidence is in `.government/repair-discovery-offline-host-2026-09-20/`: `manifest.json`, `corpus.json`, `implementation.json`, and `qualification.json`. Identity: `28bc413a432720b60f25fbbc984ca385d56584bf0bf79cf8057ff098cdfb08f7`. A preceding outer-sandbox namespace failure is retained in `.government/repair-discovery-offline-2026-09-20/`; all its outcomes were indeterminate and it is not qualification evidence.

Repository validation: typecheck and lint passed; 147 tests passed, one opt-in host-isolation test skipped, 714 assertions. The real task qualification above ran separately with the isolated host runner. It did not rerun every host resource-isolation probe.

Next implementation: the bounded shared-first-attempt comparison controller described in the protocol, including durable branch lineage, equal-attempt policy accounting, frozen order and fail-closed stops. This offline stage does not implement or launch that controller, establish feedback benefit, or authorize promotion.
