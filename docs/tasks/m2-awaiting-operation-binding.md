# M2-A5 — Awaiting frame and operation binding

Status: complete

Behavior and scope: an awaiting frame now retains its immutable call input. On every persisted read, its operation ID, execution ID, abstraction, retry attempt, input, state, lifecycle, and outbox payload are checked together. The operation must remain planned; the outbox must remain pending; their lifecycle pair must be planned/pending, dispatched/dispatched, or indeterminate/indeterminate.

The outbox payload has an exact operation envelope containing operation ID, abstraction, input, and retry attempt. A disagreement blocks inspection. The lifecycle is observed as durable state; this slice does not infer an external outcome.

Acceptance evidence:

- planned, dispatched, and observed persistence paths still read correctly;
- altering an awaiting operation's abstraction in SQLite blocks execution inspection;
- bun test tests/storage-graph-execution.test.ts passes.

Open issues / next step: classify persisted operations after startup under the writer lock. Planned intents may become eligible for an explicit dispatcher; dispatched and indeterminate work requires attributable reconciliation and cannot be replayed automatically.
