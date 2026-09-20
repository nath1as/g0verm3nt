# M2-C2 — Run-bound graph execution intent

Status: complete

Behavior and scope: a fresh graph operation intent may name a live run. One transaction persists its pinned graph execution, one-to-one run/execution relation, operation intent, outbox row, operation event, and run attachment event. The relation is stored separately from graph executions so graph records remain independently inspectable and later ledger queries can follow operation to execution to run to ancestors.

Each run has at most one fixture graph execution, and an execution belongs to at most one run. A failed duplicate attachment rolls back the new graph execution and all associated intent records.

Acceptance evidence:

- a run-bound initial intent reads back through the run after SQLite reopen;
- the owning run records the attachment event;
- a second execution for the same run fails without leaving a partial execution;
- bun run check passes.

Dependencies and exclusions: this creates the ownership join required by reservations. It does not yet reserve or charge a budget, impose operation limits, or make graph lifecycle changes settle runs.
