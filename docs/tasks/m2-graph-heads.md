# M2-D1 — Durable graph heads

Status: complete

Behavior and scope: a named graph head points to an immutable persisted graph definition and carries an independent monotonically increasing version. Creation starts at version zero. A commit requires the exact expected version, validates that the candidate graph definition exists, advances the head by one, and records a head event in the same SQLite transaction.

Frame revisions remain separate from graph publication versions. A stale expected version cannot change the head or append an event. Reopening SQLite restores the exact graph reference, version, timestamp, and event history.

Proposals, validation receipts, dependency status, suspension, and composition views remain later M2-D slices.

Acceptance evidence:

- a persisted graph definition initializes a named head;
- an expected-version commit advances it exactly once;
- a competing stale commit is rejected without mutation;
- reopening SQLite restores the committed head;
- bun run check passes.
