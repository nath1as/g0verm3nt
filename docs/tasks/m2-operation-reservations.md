# M2-C3 — Inclusive operation reservations

Status: complete

Behavior and scope: a running root or owned child may be created with one immutable non-negative operation allocation. Every graph operation admitted for a run-bound execution reserves one operation before its outbox record becomes durable. The transaction checks the owning run and every ownership ancestor; each allocation counts reservations in its full descendant subtree.

The operation ID is the reservation identity. A reservation remains after dispatch, observation, or indeterminate recovery, so an ambiguous external attempt cannot regain capacity. Later operations on an already attached execution derive their owner through the durable run/execution relation; callers cannot select a different run to bypass the allocation. A failed allocation check rolls back the execution/frame update, attachment, operation, outbox, reservation, and events together.

This is the fixture's admission ledger only. It records count reservations, not provider usage, a monetary budget, release, or settlement. Unique actual charges and inclusive usage totals remain later work.

Acceptance evidence:

- a child reservation consumes both its local allocation and its parent's inclusive allocation;
- a sibling intent exceeding the parent allocation leaves no graph execution, run attachment, operation, outbox, or reservation;
- a run-bound intent without allocations fails with no partial records;
- an indeterminate operation retains its reservation;
- reopened SQLite reports the same inclusive reservation total;
- bun run check passes.
