# M2-A4 — Strict pinned frame decoding

Status: complete

Behavior and scope: persisted frame reads now verify canonical bytes, reconstruct the pinned graph definition, and decode the frame through exact state shapes. The decoder validates graph, operation, and attempt identities; JSON values; terminal failures; retry bounds and unique retry identities; and continuation nodes drawn from the pinned graph. Awaiting calls must target an abstraction in the pinned catalogue.

This is an inspection boundary. It rejects malformed or unrelated state before exposing a frame, but does not advance, dispatch, or reconcile it.

Acceptance evidence:

- persisted running, awaiting, and terminal frames remain readable;
- a hash-valid frame with an extra state field is rejected;
- bun test tests/storage-graph-execution.test.ts passes.

Open issues / next step: bind awaiting frames to their operation records, then define restart reconciliation that classifies planned, dispatched, and indeterminate work without replaying it automatically.
