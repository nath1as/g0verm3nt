# M1 — Command receipt slice

Status: complete

Behavior and scope: a versioned start-run command has a validated command ID, workspace ID, origin, and SHA-256 payload hash. The local SQLite store records the receipt atomically with the run's initial event. Repeating the same command returns its existing run; reusing the command ID with different payload content is rejected.

Relevant spec and plan sections: plan sections 3 and 10 (M1); formal model section 3.

Dependencies and exclusions: one local writer and sequential requests only. This slice does not yet decode untrusted JSON, validate every envelope field at the CLI boundary, use the pure M1 decision path for storage writes, or reconcile a crash after an external dispatch.

Acceptance examples and invariants:

- A repeated command after reopening the database never invokes the model again.
- A conflicting payload with the same command ID never creates another run.
- The receipt and the root `RunRequested` event commit in one SQLite transaction.

Failure / restart cases: replay of terminal commands is covered. A command whose receipt exists while its run is still active requires the later recovery/scheduler model.

Required checks and runnable demonstration: `bun run check`.

Results: `bun run check` passed on 2026-09-19. The test suite proves accepted, repeated-after-restart, conflicting, and tampered-payload command outcomes.

Open issues / next step: make the CLI construct and validate envelopes, then route its command through the pure admission function before adding the first graph operator.
