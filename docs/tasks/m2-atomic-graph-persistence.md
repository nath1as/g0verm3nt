# M2-A1 — Atomic graph operation persistence

Behavior and scope: canonical JSON sorts object keys and SHA-256 hashes every persisted graph definition, catalogue, and frame payload. Additive migrations track the supported database schema. Graph definition and catalogue references are insert-only: reusing a reference with different content fails. A graph execution pins its graph definition reference and stores a versioned, hashed frame with a compare-and-swap revision.

Planning an operation is one SQLite transaction: persist immutable dependencies if absent, write the advanced awaiting-call frame, insert the planned operation, insert its pending outbox payload, and append the planned operation event. A second transaction marks the operation and outbox dispatched before any external boundary. Only a dispatched operation may be observed; observation then transitions both records to observed, writes the resulting frame, and appends the observed event. An explicit indeterminate transition preserves an unresolved dispatch without claiming success or making it dispatchable again. A duplicate operation identity rolls the entire planning transaction back, including any proposed frame change.

Relevant spec and plan sections: formal model sections 6–7; plan M2 atomic events/projections/outbox; lean plan phase 2, item 3.

Dependencies and exclusions: reads reject unsupported frame/definition encodings, noncanonical hashes, malformed artifact shapes, mismatched manifest/catalogue references, invalid closed graph syntax, malformed contract/schema payloads, and graph/catalogue combinations that do not recheck. This is still explicit persistence and inspection only. It does not perform external dispatch, reconcile an indeterminate request, or resume execution automatically. Those controls are required before recovery is enabled.

Acceptance evidence:

- canonical encoding and hashes agree across different object key orders;
- a committed intent survives a store reopen with its awaiting frame and pending outbox row;
- an observation persists its terminal frame and clears the pending outbox row;
- a conflicting operation identity leaves the prior frame unchanged because the transaction rolls back;
- a tampered persisted definition blocks frame inspection through canonical-hash verification;
- a hash-valid malformed catalogue or semantically invalid graph cannot reconstruct a runnable definition;
- an observation cannot advance a merely planned operation, and an indeterminate operation is not dispatchable;
- `bun run check` passes.

Open issues / next step: define restart reconciliation for planned, dispatched, observed, and indeterminate operations without automatic redispatch.
