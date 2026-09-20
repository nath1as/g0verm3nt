# M1 — Closed graph fragment: id, call, seq

Status: complete

Behavior and scope: the core now owns a closed, serializable graph grammar with only `id`, exact `call`, and `seq`. Graph decoding rejects unknown constructors and fields. A pure checker derives exact input/output schema references, ordered calls, and combined effect bounds from a fixed catalogue of exact abstraction references. The reference interpreter invokes only catalogue-resolved calls after checking the complete graph.

Relevant spec and plan sections: plan section 6, graph operators 1; formal model section 6.

Dependencies and exclusions: schema compatibility is exact-reference equality in this fragment. Contracts, frames, graph persistence, wire/route/guard, retries, and scoped child calls remain later M1/M2 slices. The supplied interpreter is a small pure reference interpreter, not a durable execution machine.

Acceptance examples and invariants:

- `id(schema)` checks as an effect-free identity from that exact schema to itself.
- A `call` resolves only the recorded abstraction version; an unregistered version is rejected.
- `seq` requires the first output reference to equal the second input reference before any handler executes.
- Sequence effects union named footprints and sum bounded operation counts.

Results: `bun run check` passed on 2026-09-19.

Open issues / next step: add named contracts and structural `wire`, followed by finite `route` and `guard` predicates.
