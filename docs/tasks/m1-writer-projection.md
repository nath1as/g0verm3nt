# M1 — Writer-owned active-run projection

Status: complete

Behavior and scope: application startup reconstructs a pure projection from durable rows whose status is `running`. A single local writer serializes receipt lookup, pure admission, SQLite commit, and replacement of that projection. Model streaming happens after the committed start transaction, outside the writer. Terminal completion returns the run to SQLite and removes it from the active projection only after that write commits.

Relevant spec and plan sections: plan section 3, command identity and ordering; plan M1 and M2.

Dependencies and exclusions: this is a local single-process writer. It does not claim process ownership, atomic operation outboxes, startup reconciliation of pending model operations, or crash-safe dispatch; those remain M2 work.

Acceptance examples and invariants:

- A restarted application projects a persisted running run before accepting any command.
- Two concurrent submissions with the same command envelope produce one accepted dispatch and one duplicate receipt.
- An injected failure of the run-and-receipt transaction leaves the active projection empty and does not invoke the model.
- Settling a run removes only that run from the active projection through a pure `RunSettled` event.

Results: `bun run check` passed on 2026-09-19.

Open issues / next step: implement the first closed graph AST fragment (`id`, exact `call`, and `seq`) with a pure structural checker.
