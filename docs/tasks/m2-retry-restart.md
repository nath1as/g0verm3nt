# M2-B2 — Durable retry restoration

Status: complete

Behavior and scope: a retryable observed failure persists the resulting running frame before the process closes. On restart, strict frame decoding rebuilds the pinned retry continuation with its original input, witness, attempt ordinal, completed attempt IDs, and used operation IDs. The next operation is planned only after that restored frame is read.

The awaiting retry frame must agree with its innermost retry continuation: an active retry requires a non-null matching attempt ID and ordinal, and that continuation must include the awaiting operation ID. Retry-witness comparison uses canonical JSON because persisted records have canonical key order.

Acceptance evidence:

- attempt one fails with a declared retryable failure, then SQLite is closed and reopened;
- the restored frame rejects reuse of the first operation ID and plans attempt two using the original input;
- the second planned operation persists its attempt ID and ordinal across another restart;
- a hash-valid frame with a null awaiting attempt and an active retry continuation is rejected;
- bun run check passes.

Dependencies and exclusions: frame recovery cross-checks retry operation history against the persisted operation rows for the same execution. No startup dispatcher or automatic replay is enabled.
