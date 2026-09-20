# M2-A7 — Attributable adapter reconciliation

Status: complete

Behavior and scope: recovery classification makes a previously dispatched operation indeterminate. An explicit reconciliation adapter exposes only a lookup method keyed by the durable operation ID; it receives the pinned execution ID, abstraction, input, and retry attempt. It has no dispatch or replay API.

An unknown lookup leaves the frame, operation, and outbox unchanged. A matching observed result advances the pure frame and atomically records the observation, an immutable adapter reference, external operation ID, canonical evidence, and the updated frame. This path accepts only the indeterminate lifecycle. The operation record and reconciliation record each enforce a single accepted settlement.

Acceptance evidence:

- an unknown result retains the indeterminate lifecycle, frame revision, and absent pending outbox;
- a mismatched returned operation ID is rejected without settling;
- a matching result commits the terminal frame and one immutable reconciliation attribution;
- bun test tests/storage-graph-execution.test.ts passes;
- FakeOperationReconciliationAdapter exercises the lookup contract end to end.

Dependencies and exclusions: this is an adapter contract and persistence boundary only. It includes no provider implementation, automatic startup lookup, dispatch, or retry of external work.
