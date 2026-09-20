# M1 — Immutable graph definitions and catalogue manifests

Behavior and scope: a graph definition binds an exact graph reference to a checked graph and an exact in-memory catalogue manifest. The manifest enumerates every available exact abstraction and schema reference. Definition construction rejects a manifest that differs from the catalogue used for checking, then snapshots the graph and catalogue so later caller mutation cannot change execution dependencies. Registries return a new map on registration and reject duplicate exact references; there is no mutable graph head.

The conformance driver steps a definition frame, assigns operation and retry-attempt identities, feeds typed operation observations back into it, and compares the resulting output/failure and call trace with the reference interpreter. The exercised fixture is a retrying call followed by a sequential call.

Relevant spec and plan sections: formal model section 6, exact graph references and private definitions; plan sections 6 and 7; lean plan phase 1, item 2.

Dependencies and exclusions: manifest and definition records are in-memory snapshots only. They have no canonical encoding or hash, SQLite persistence, heads, aliases, operation outbox, crash reconciliation, or cross-process writer ownership. Those become M2 work under an atomic transaction.

Acceptance evidence:

- manifest construction records the exact schema and abstraction references;
- a mismatched manifest cannot define a graph;
- definition snapshot data survives mutation of the caller's catalogue;
- duplicate references do not overwrite a registered definition;
- the frame driver and reference interpreter agree on output and calls for the bounded retry fixture;
- `bun run check` passes.

Open issues / next step: introduce canonical encoding and hashes, then persist definitions, manifests, frames, operation intents, and observations atomically with an outbox row.
