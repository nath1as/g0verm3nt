# M2-C1 — Durable run ownership

Status: complete

Behavior and scope: a running parent may atomically create an owned child run. The relation records the parent, child, creation time, and monotonically assigned spawn order. Parent events record each child spawn. A parent cannot settle while any owned child remains running.

The relation remains queryable after reopening SQLite. Child failure propagation and runnable-operation permits are now implemented in the follow-up M2-C slices. Cancellation propagation, depth and child limits, and actual usage charges remain later work.

Acceptance evidence:

- two children receive stable spawn order;
- parent settlement rejects while either child remains running;
- parent settles after both children are terminal;
- reopen retains terminal child statuses, ownership, and parent spawn events;
- bun run check passes.
