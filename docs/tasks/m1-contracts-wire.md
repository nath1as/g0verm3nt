# M1 — Named contracts and structural wire

Status: complete

Behavior and scope: callable abstractions now carry a named contract: exact input/output schema references, declared effect bound, permitted failure names, verifier reference, assumptions, and assurance level. The graph grammar adds `wire`, a closed record-to-record structural map. A wire lists each target field and its source field; it may project, reorder, pair, or copy immutable JSON values, but has no host callback and no effects.

Relevant spec and plan sections: plan section 6, contract language and graph operator 2; formal model section 6.

Dependencies and exclusions: schema compatibility remains exact-reference equality. Record schema catalogues are authored in memory in this slice. Durable contract/schema registry decoding, refinement predicates, graph frames, and persisted graph versions remain later M1/M2 work.

Acceptance examples and invariants:

- A call derives its boundary and effect from its recorded contract rather than graph-local fields.
- A wire requires registered record schemas and maps every target field exactly once.
- Missing fields, repeated target fields, unknown fields, and unequal field-schema references are rejected before execution.
- The reference interpreter returns a new record and records no operation for a valid wire.

Results: `bun run check` passed on 2026-09-19.

Open issues / next step: add finite `route` and `guard` predicates over declared tags and bounded metadata.
