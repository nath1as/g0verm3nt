# M1 — Serializable graph execution frames

Status: complete

Behavior and scope: the checked graph fragment has a data-only execution frame. A frame records its schema version, exact graph reference, current AST node, JSON value, sequence continuations, and pending call operation identity. The pure stepper evaluates structural nodes one transition at a time. Reaching `call` emits an operation plan and changes the frame to `awaitingCall`; only a matching observation may resume it. A false guard becomes terminal `GuardRejected` without planning its body.

Relevant spec and plan sections: plan sections 3 and 6, persisted programs; formal model sections 2 and 6.

Dependencies and exclusions: frames are serializable values but are not yet stored in SQLite. This slice does not add an outbox, external dispatch, crash reconciliation, durable graph-definition registry, child ownership, or recovery writer locking; those are M2 work.

Acceptance examples and invariants:

- A sequence retains its exact second graph as a continuation while the first call awaits its operation observation.
- A response with the wrong operation ID cannot advance the frame; a duplicate after terminal state is rejected.
- Operation IDs are supplied by the runtime boundary, never generated in the pure frame stepper.
- A guard failure is terminal and plans no capability call.

Results: `bun run check` passed on 2026-09-19.

Open issues / next step: store graph definitions and frames with atomic intent/outbox records, then add bounded `retry` with a restoration witness.
