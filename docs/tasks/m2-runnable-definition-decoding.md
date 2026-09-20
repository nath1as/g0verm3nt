# M2-A3 — Runnable pinned graph definition decoding

Status: complete

Behavior and scope: each persisted graph execution now rebuilds its graph definition from pinned JSON before a frame is exposed. The decoder accepts only exact reference syntax; unique, sorted manifest references; exact schema wrappers; atomic and record schemas; declared predicate domains; contracts; bounded effects; verifier references; and assurance values. It resolves every contract and record-field schema reference.

The decoder then calls defineGraph with the rebuilt maps. This recomputes the graph's interfaces, calls, failure set, and effect bound. The persisted checked field is treated as a derived cache and is not trusted for execution.

Acceptance evidence:

- a normal persisted definition rebuilds to its original checked graph;
- a hash-valid catalogue with a negative operation bound is rejected;
- a hash-valid graph naming an absent abstraction is rejected as not runnable;
- bun test tests/storage-graph-execution.test.ts passes.

Dependencies and exclusions: this reconstructs a checked in-memory definition only. It does not validate or advance a stored frame as a recovery action, bind a definition to executable provider code, dispatch an outbox row, reconcile an indeterminate operation, or enable automatic restart.

Open issues / next step: define frame decoding and restart reconciliation under the writer lock, with no automatic replay of dispatched or indeterminate work.
