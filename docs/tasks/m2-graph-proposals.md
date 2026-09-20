# M2-D2 — Immutable graph proposals and checked receipts

Status: complete

Behavior and scope: a proposal records a named head, exact base graph reference and version, candidate graph reference, optional origin run, and immutable pending identity. A checked receipt records the proposal's exact head/version/candidate binding and validation fingerprint.

Commit rechecks the proposal, receipt, and current head inside one SQLite transaction. One proposal advances the head and becomes committed; a competing proposal targeting the same base is marked stale and cannot mutate the head. Proposals and receipts remain queryable after restart.

This slice does not yet validate evidence policy, direct dependencies, suspension, or composition views.

Acceptance evidence:

- two proposals can target one base head;
- one checked proposal commits and advances the head;
- the competing proposal becomes stale without changing the head;
- committed and stale records survive SQLite reopen;
- bun run check passes.
