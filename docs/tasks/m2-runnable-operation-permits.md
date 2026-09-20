# M2-C4 — Runnable-operation permits

Status: complete

Behavior and scope: each ownership tree has one durable runnable-operation permit. A running parent can acquire it for one operation, release it while waiting on owned children, and an owned child can then acquire it. The permit is tied to the ownership tree root, holder run, operation identity, and acquisition time.

Acquisition and release are transactional and audited as run events. A second holder cannot acquire the permit; only the current holder can release it. Reopening SQLite preserves the current holder or the absence of a permit.

This slice models runnable capacity only. It does not dispatch work, add provider-specific concurrency, or replace operation reservations and actual usage accounting.

Acceptance evidence:

- the parent acquires the tree permit;
- the child cannot acquire it while the parent holds it;
- releasing the permit while the parent waits lets the child acquire it;
- a different run cannot release the child’s permit;
- release and restart leave no stale permit;
- bun run check passes.
