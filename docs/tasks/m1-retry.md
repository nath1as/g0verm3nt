# M1 — Bounded retry graph operator

Behavior and scope: the closed graph grammar now supports `retry`. A retry has a finite attempt cap and a structured, authored witness: exact precondition schema, witness cap, declared retryable failures, same-input restoration, required idempotency, and an effect ceiling. The checker verifies the body's input and declared failures, caps attempts, and charges the worst-case repeated effect. The reference interpreter accepts typed call outcomes; it retries only declared domain failures and never host exceptions.

Frames model retries as explicit continuations. They retain the original body input, ordinal, attempt ID, completed attempt IDs, and used operation IDs. A retryable failed observation discards only the failed body's continuations and starts the next ordinal with the retained input. A successful body resumes its outer continuation. Operation IDs and attempt IDs cannot be reused within a retry scope.

Relevant spec and plan sections: formal model section 6, especially the retry rule; plan section 6 graph operator 3; lean plan phase 1.

Dependencies and exclusions: witnesses are inline immutable graph data in M1 because immutable graph/catalogue manifests are the next slice. The frame is serializable data but has no SQLite persistence, outbox transaction, provider reconciliation, or verified external restoration. M2 will persist graph definitions, attempt chains, operation intents, and recovery decisions atomically.

Acceptance evidence:

- decoding rejects zero, fractional, unsafe, or malformed retry data;
- checking rejects witness-cap, precondition, undeclared-failure, and effect-ceiling violations;
- reference execution stops after success, a nonretryable failure, or the final attempt;
- frame execution assigns unique attempt and operation identities and restores the original retry input after a retryable failed observation;
- `bun run check` passes.

Open issues / next step: add immutable graph definitions and catalogue manifests, then make frames and operation intents durable under a single writer transaction.
