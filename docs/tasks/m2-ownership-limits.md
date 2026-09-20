# M2-C6 — Fixed ownership limits

Status: complete

Behavior and scope: the fixture permits at most two direct children per run and four ownership levels below a root. Child-count and depth checks run inside the same transaction as child insertion, allocation creation, ownership linking, and spawn events.

Completed children still consume structural child capacity. A rejected spawn leaves no run, ownership row, allocation, event, or consumed spawn order. The limits are fixed fixture policy rather than a general configurable scheduler.

Acceptance evidence:

- a third direct child is rejected atomically;
- a chain reaches depth four;
- a fifth ownership level is rejected atomically;
- reopening SQLite preserves the accepted tree and does not admit the rejected nodes;
- bun run check passes.
