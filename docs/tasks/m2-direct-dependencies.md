# M2-D3 — Direct dependency links

Status: complete

Behavior and scope: proposals may persist direct dependency edges identified by dependency kind and exact reference. Edge identity is unique per proposal; duplicate edges fail transactionally. A proposal cannot depend on its candidate graph. Forward and reverse lookups are deterministic and survive SQLite restart.

Dependency status, transitive invalidation, suspension, and bounded composition views remain later work.

Acceptance evidence:

- proposal dependencies persist with the proposal transaction;
- duplicate edge identity is rejected without partial changes;
- candidate self-dependencies are rejected;
- forward lookup returns stable edges;
- reverse lookup returns dependent proposals;
- bun run check passes.
