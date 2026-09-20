# M2-A8 — Deterministic reconciliation adapter fixture

Status: complete

Behavior and scope: FakeOperationReconciliationAdapter is a deterministic provider-shaped implementation of the reconciliation lookup contract. Records are keyed by the durable operation ID and contain an external operation ID, JSON evidence, and either a success output or a failure string. The adapter records lookup requests for assertions. It exposes no dispatch, send, or retry method and has no SQLite dependency.

The storage integration exercise follows the durable recovery sequence: planned, dispatched, classified indeterminate, lookup unknown, then attributed lookup observed. The unknown lookup leaves the indeterminate frame unchanged. The observed lookup advances and records the frame and attribution through the existing atomic persistence boundary.

Acceptance evidence:

- lookup receives the exact persisted execution, operation, abstraction, input, and retry attempt;
- an absent fixture record is unknown without a frame revision change;
- a recorded result settles through the same reconciliation path used by future provider adapters;
- bun run check passes.

Dependencies and exclusions: this is an offline fixture, not a production provider. Selecting and integrating a production transport remains the M3 compatibility decision.
