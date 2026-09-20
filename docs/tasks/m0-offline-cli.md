# M0 — Offline CLI vertical prototype

Status: complete

Behavior and scope: a deterministic fake model progresses one root run through `RunRequested`, `OperationPlanned`, `OperationObserved`, and a terminal event. The CLI persists it in SQLite, can cancel during its artificial stream, and can inspect saved runs after a new process starts.

Relevant spec and plan sections: plan sections 3, 4, 5, 10 (M0), and 14; formal model sections 2–3.

Dependencies and exclusions: Bun's built-in SQLite driver; no real provider, graph registry, child supervision, model billing, recovery/reconciliation, or TUI.

Acceptance examples and invariants:

- A successful fake run has one attributable terminal outcome and ordered durable events.
- Cancelling a pending fake operation produces `Cancelled`, never `Succeeded`.
- Inspection from a newly opened database returns the persisted result and event history.
- Repeating `init` preserves existing state.

Failure / restart cases: M0 proves inspection after restart only. It does not claim safe recovery across an external dispatch boundary.

Required checks and runnable demonstration: `bun run check`; `bun run demo`; run, cancel, and inspect with a temporary state directory.

Results: `bun run check` passed on 2026-09-19: strict TypeScript, Biome, and four deterministic tests. The CLI demonstration persisted `RunRequested → OperationPlanned → OperationObserved → RunCompleted`; the `--cancel-after-ms 1` scenario persisted `RunCancelled`. Bun 1.4.2, Effect 3.22.2, TypeScript 5.9.3, and Biome 2.4.3 are pinned in `bun.lock`.

Open issues / next step: M1 introduces pure state transitions, immutable identities, and the smallest supported graph semantics. M0 does not support cross-process cancellation, outbox recovery, child runs, or graph revisions.
