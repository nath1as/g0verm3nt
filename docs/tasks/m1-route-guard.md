# M1 — Finite route and guard predicates

Status: complete

Behavior and scope: the graph grammar now has `route` and `guard`. Predicates are closed data: Boolean constants, `not`, `and`, `or`, exact tag equality, and inclusive integer bounds. A predicate can inspect only a field whose record schema declares a finite tag set or bounded integer domain. `route` requires both branch inputs and outputs to agree, chooses one branch at interpretation time, and uses an effect upper bound across the alternatives. A false `guard` yields the explicit `GuardRejected` outcome without dispatching its body.

Relevant spec and plan sections: plan section 6, graph operator 2; formal model section 6.

Dependencies and exclusions: predicates do not prove arbitrary refinements, inspect opaque values, call host code, or classify domain data. Graph persistence, frames, retries, and parallel execution remain later slices.

Acceptance examples and invariants:

- A route can use a declared finite `kind` tag and invokes only the selected branch.
- Unknown fields, undeclared predicate domains, and values outside their declared finite domain are rejected before interpretation.
- A guard contributes `GuardRejected` to the derived failure set; `checkGraphAgainstContract` rejects it when the enclosing contract does not admit that failure.
- Route effects union footprint names and use the maximum branch operation bound.

Results: `bun run check` passed on 2026-09-19.

Open issues / next step: add persisted graph definitions and explicit execution frames, then bounded `retry` with its restoration witness.
