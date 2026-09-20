# M2-B3 — Retry operation-history binding

Status: complete

Behavior and scope: when a persisted frame awaits a retry operation, every retry continuation in its stack is checked against graph operation rows from the same execution. The frame operation-ID set must exactly equal the persisted rows whose attempt IDs belong to that continuation. Completed attempt IDs must have at least one observed operation and every one of those operations must have a durable observation.

The check allows retry ordinals without an operation identity, because a guarded body can fail before a call. It rejects reused retry history across nested continuations, missing operation rows, undeclared attempt IDs, incomplete operation sets, and completed attempts that have not durably observed.

Acceptance evidence:

- a close/reopen retry chain retains the exact operation and attempt history;
- changing the historical first operation to another attempt ID blocks frame inspection;
- a malformed active awaiting attempt still blocks strict frame decoding;
- bun run check passes.

Dependencies and exclusions: this is read-time integrity validation for persisted retry state. It does not add dispatch, replay, run ownership, or accounting.
