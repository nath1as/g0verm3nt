# M1 — Core admission slice

Status: complete

Behavior and scope: construct validated run identities, admit one `StartRun` input through a pure decision, and project the resulting `RunStarted` event into immutable runtime state. This slice has no persistence, model dispatch, graph, child, or ledger behavior.

Relevant spec and plan sections: plan sections 3 and 10 (M1); formal model sections 1 and 3.

Dependencies and exclusions: uses only `src/core`. M0's SQLite adapter remains its own boundary until a later slice maps committed domain events to storage.

Acceptance examples and invariants:

- A blank or malformed run identity is rejected before state changes.
- A valid start decision contains one event and does not mutate the input state.
- Applying the event creates one running aggregate at revision zero.
- A second start for the same run is rejected.

Failure / restart cases: command identity, transaction/replay, and storage recovery remain later M1/M2 slices.

Required checks and runnable demonstration: `bun run check`.

Results: `bun run check` passed on 2026-09-19 with the M0 suite and three M1 admission tests. The core has no imports from runtime, storage, CLI, adapters, or UI.

Open issues / next step: add command envelopes and receipts before wiring this pure admission path to durable storage; then add the smallest `id`/`call` graph fragment.
