# M2-C5 — Unique operation usage and inclusive totals

Status: complete

Behavior and scope: a terminal graph operation may receive one actual usage record keyed by its operation ID. Usage is a non-negative safe integer or explicit unknown. Unknown usage remains an unresolved liability and is never counted as zero. Later authoritative evidence may settle the same row once from unknown to a known value; conflicting known values are rejected.

Usage is booked once against the operation's direct owning run. Queries project known units and unresolved-operation counts through the complete ownership subtree, so ancestors see inclusive totals without duplicate ledger rows. Reservations remain separate and are not converted into actual usage.

This fixture ledger deliberately uses generic integer units. Provider, model, currency, price-table, and multi-dimensional token accounting remain later work.

Acceptance evidence:

- an indeterminate operation records unknown usage;
- child and parent totals both retain the unresolved liability;
- later known usage settles the same operation without adding a second charge;
- conflicting usage is rejected;
- reopening SQLite preserves inclusive totals;
- bun run check passes.
