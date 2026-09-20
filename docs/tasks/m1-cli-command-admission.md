# M1 — CLI command admission slice

Status: complete

Behavior and scope: `government run` constructs a versioned `StartRunCommand`. A caller may supply `--command-id` for retries; otherwise the CLI creates one. `--workspace-id` defaults to `local`. The application validates the envelope, runs pure `StartRun` admission, evolves the resulting event, and only then creates the receipt and durable run.

Relevant spec and plan sections: plan sections 3 and 10 (M1); formal model sections 1 and 3.

Dependencies and exclusions: the in-memory pure state contains only the prospective run, because M1 has not yet restored a full runtime projection. Durable receipts provide duplicate protection. This slice does not add general JSON decoding, serialized writer ownership, or crash recovery.

Acceptance examples and invariants:

- The CLI supports deterministic retry IDs and emits the command submission outcome as JSON.
- An empty task is rejected by `decide` before the receipt/run transaction.
- The application obtains the persisted run's identity and task type from the evolved pure state, rather than constructing a second unchecked aggregate.

Failure / restart cases: repeating terminal receipts works from the prior slice. A command whose first submission crashed during or after external dispatch remains M2 work.

Required checks and runnable demonstration: `bun run check`; run the same CLI command ID twice against one temporary state directory.

Results: `bun run check` passed on 2026-09-19. Against one temporary state directory, the first `retry-1` command returned `accepted`, the repeated identical command returned `duplicate` with the same run ID, and the same ID with a different task returned `conflict`.

Open issues / next step: introduce the serial command writer and reconstructable runtime projection, then implement the first closed graph AST fragment.
