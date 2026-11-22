# Government implementation plan

Status: proposed build plan; no implementation milestones are complete.

Current implementation evidence is tracked in [the audit](docs/implementation-audit.md); the status above describes the original plan. Research continuation now follows the [repository benchmark reset](docs/tasks/repository-benchmark-plan.md). Synthetic repair pilots are closed and are not evidence of adaptive benefit.

The [official benchmark smoke bridge](docs/tasks/repository-benchmark-smoke.md) is implemented and offline-tested. Docker is available; pinned image provisioning and live base/gold qualification are pending; repository-worker isolation remains a subsequent gate.

Design authority: [Computational Shard Formal Model v0.3](./computational-shard.md).

The agreed stack is strict TypeScript, Effect, Bun, OpenTUI with React, and SQLite. Government will start as a local CLI research prototype; OpenTUI with React remains the planned interactive client after the first adaptation assessment. Its core will be functional: immutable definitions and graphs, pure decisions and state transitions, explicit effect requests, and versioned evidence.

Composition knowledge must persist across sessions independently of model conversations. Store a compact shared semantic layer in the local database: reusable capabilities, accepted workflow/composer relations, scoped observations, and unresolved composition references. Give models bounded task-specific views instead of loading an ever-growing memory transcript.

The first useful release must execute a bounded agent task, show its owned subtree and costs, survive an interrupted execution without silently repeating external effects, and demonstrate a consistent child changing its governor's composition. A later milestone must demonstrate a harness changing a higher harness's composition strategy. The implementation should establish these behaviors through runnable increments.

The first learning question is whether child-originated composition changes outperform a well-chosen fixed harness for a declared task family, executor, and budget after paying for discovery and evaluation. A successful graph mutation demonstrates the mechanism; a held-out improvement demonstrates its usefulness. Keep these outcomes separate.

### Prototype decision and scope

Build the first agent loop, graph interpreter, and governance runtime ourselves to evaluate the idea. Reuse ordinary libraries for effects, SQLite, schemas, testing, and provider transport; do not embed another agent loop or workflow engine in this prototype. The purpose is to expose our actual semantics and experimental costs with a small implementation we can inspect.

The first research sequence is M0 → M1 → M2 → M2a → M3 → M4. M2a tests an authored child-originated mutation offline before investing in a useful coding worker. M4 tests learned selection against a frozen fixed baseline. M5 is a separate test of upward composer mutation; success at M4 alone does not demonstrate it. Decide whether to continue to M5 and product work from the recorded results, rather than making every later milestone a prerequisite for learning anything.

Keep the prototype to one local writer, one task family, one real executor model, a small registered catalogue, sequential graph execution, and CLI/JSON reports. Implement the ownership and cancellation semantics even when the graph has no parallel operator. Defer the TUI, `par`, continuous runtime, packaging, and optional uncertainty experiments until the first M4 assessment. These are planned follow-ups, not waived checks on features that ship.

Before each research stage, record a finite task/candidate count, implementation scope, model-spend ceiling where applicable, and stopping condition in its task record. Stop an experiment when its frozen budget is exhausted and report insufficient evidence. Do not expand the framework or lower promotion thresholds simply to obtain a positive result.

## 1. Build decisions

| Area | Decision | Rationale |
|---|---|---|
| Language | Strict TypeScript | Tagged unions and explicit interfaces suit the model while keeping provider and terminal integration practical. |
| Functional core | Plain immutable TypeScript | Domain decisions remain deterministic and directly testable. |
| Effect execution | Effect behind service interfaces | Use its error, concurrency, resource, and streaming facilities; implement Government's specific ownership and revision semantics explicitly. |
| Runtime/toolchain | Bun | One initial runtime, package manager, test runner, and SQLite driver. |
| Terminal UI | OpenTUI with React after M4 assessment | Reuse the CLI application API; defer rendering work while testing adaptation. |
| Persistence | SQLite through `bun:sqlite`, explicit SQL migrations | Local transactions, append-only events, immutable versions, and queryable projections without a separate database service. |
| Shared composition state | Normalized versioned records and bounded query views in the same database | Retain compositional structure across sessions and planner models without duplicating transcripts or creating a second store of truth. |
| Large artifacts | Content-addressed local files | Keep transcripts, patches, datasets, and tool output out of hot state queries. |
| Model integration | Evaluate Pi's provider package behind a Government adapter | Reuse transport and streaming support without adopting another harness's governance model. |
| Agent loop | Small Government-owned state machine | Control task context, child spawning, ledger accounting, resumability, and operation identity. |
| Tests | `bun:test` plus `fast-check` | Scenario tests, crash tests, and generated state-machine sequences. |
| Formatting/lint | Biome plus TypeScript checking | One ordinary style and a fast feedback loop. |
| Initial platform | Linux, local single-owner workspace | Match the current development environment; add platform support after the runtime is reliable. |

Effect documents typed errors, scoped resources, concurrency, schemas, and streaming. These are supporting tools, not a proof that its default fiber lifecycle matches our shard model. [Effect documentation](https://effect.website/docs/v3/getting-started)

OpenTUI provides React bindings. Select and test exact compatible releases when the interactive-client follow-up begins. [OpenTUI React documentation](https://opentui.com/docs/bindings/react/)

Bun provides a SQLite driver with transactions and prepared statements. Use its documented WAL support with a single application writer. [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)

### Dependency policy

- Pin direct dependency versions and the Bun runtime after M0's compatibility checks; commit one lockfile.
- Select one supported stable Effect major. Check the current release metadata rather than following a homepage command or mixing examples from different majors.
- Keep the chosen major's documentation and local installed types as the implementation reference.
- Use Effect Schema at external/persistence boundaries. Core values remain ordinary readonly data; pure validation helpers may use schema functionality without importing runtime services.
- Avoid introducing an additional async framework, state manager, ORM, or general agent orchestration framework initially.
- Use `bun:test` for platform/native integration as well as core tests. Verify `fast-check` under this runner in M0; verify OpenTUI's testing utilities when adding the TUI.
- Treat version-specific incompatibilities as an adapter or dependency-selection issue before changing the architecture.

The proposed test and lint tools have maintained primary documentation: [Bun test runner](https://bun.com/docs/test), [fast-check](https://fast-check.dev/docs/introduction/), and [Biome](https://biomejs.dev/).

### Workspace configuration and bootstrap

Use a versioned `government.json` for task aliases, exact catalogue seed references, runtime/model profiles, budget defaults, and evaluation policies. Resolve ordinary settings in this order: built-in defaults, project configuration, documented environment overrides, explicit CLI options. Decode the resolved configuration and record its hash with each run.

Authority is separate from settings precedence. Repository files and agent requests cannot enlarge the workspace owner's granted capability ceiling. `doctor` reports effective nonsecret settings, their origins, missing dependencies, and blocked requirements.

`init` creates state and installs a versioned bootstrap catalogue, root governor, and fixture definitions/heads idempotently. Preserve existing configuration. M0 seeds only its minimal fixture; M1 expands the catalogue through migrations. Registration verifies schemas, executable identities, and hashes; it never executes arbitrary code named by a manifest. Add catalogue inspection and validation commands in M1.

## 2. Reuse strategy

Build a new application around Government's domain model. Do not begin with a wholesale fork of a coding agent or self-improving harness.

| Candidate | Intended use | Acceptance condition |
|---|---|---|
| Pi provider package | Preferred reusable model transport | Preserves streaming, cancellation, tool-call identity, model metadata, failures, and usage through our adapter under Bun. |
| Pi agent core | Reference only for the first prototype | Government owns the loop, operation admission, and resumable state; reconsider embedding only after the experiment identifies a concrete need. |
| Pi coding-agent application | Reference for terminal interaction and context handling | Any copied implementation has a concrete local purpose and retained license/provenance. |
| HarnessX | Reference for trace analysis and adaptation experiments | Borrow an identified idea or bounded component only if it fits our abstraction/relation mutation model. |
| OpenTUI | Use as a dependency | Native rendering, keyboard handling, teardown, and packaging pass the compatibility spike. |

Pi separates its model API and agent runtime into packages. Its model documentation includes streaming cancellation and usage-bearing responses; test these properties rather than assuming they survive every provider failure. [Pi provider package](https://github.com/earendil-works/pi/tree/main/packages/ai), [Pi agent package](https://github.com/earendil-works/pi/tree/main/packages/agent)

HarnessX's behavior-composition and adaptation architecture is relevant reference material, but its framework should not define Government's execution state. [HarnessX repository](https://github.com/Darwin-Agent/HarnessX)

Make the provider decision at the start of M3; it must not delay the offline mutation experiment:

1. Test the current Pi provider package with recorded/mock transport where possible and one opt-in live request when credentials are available.
2. Record its exact package/version, license, selected exports, and behavior gaps.
3. Accept it if it can satisfy the Government `ModelGateway` contract without hidden agent orchestration.
4. If it fails, implement one direct provider adapter using that provider's SDK. Keep the same Government interface and defer additional providers.

A live API failure or unavailable key must not block the deterministic vertical prototype. Do not silently substitute another provider or incur unconfigured model charges.

## 3. Functional architecture

### Core rule

Represent changes as data. Domain code decides which changes are legal; the runtime executes admitted effects and reports their outcomes as further inputs.

```text
CLI/TUI command or adapter observation
    → validate and stamp input envelope
    → decide(currentState, input)
    → domain events
    → SQLite transaction: append events + update projections + record effect intents
    → publish committed event sequence
    → Effect workers dispatch recorded intents
    → adapter observations return through the same command path
```

Conceptual interfaces:

```ts
type Decision = Readonly<{
  events: ReadonlyArray<DomainEvent>;
}>;

declare function decide(
  state: RuntimeState,
  input: RuntimeInput,
): Result<Decision, DomainRejection>;

declare function evolve(
  state: RuntimeState,
  event: DomainEvent,
): RuntimeState;
```

`RuntimeInput` includes externally supplied IDs, timestamps, observations, and version expectations. The core never reads the clock, generates randomness, starts a process, calls a model, or accesses SQLite. An `OperationPlanned` event produces a durable outbox entry in the same transaction as its state transition.

Readonly types are an implementation convention, not a substitute for validation. Decode untrusted values from `unknown`; construct branded IDs and validated graph references through checked constructors. Use exhaustive pattern matching and explicit error variants. Avoid a generic service locator or pervasive `any`.

### Command identity and ordering

Every command/observation envelope carries a schema version, workspace ID, command ID, origin, payload hash, causal ID, and expected aggregate revision where applicable. Operation attempts have separate identities; provider tool-call IDs are namespaced by model request.

Persist command receipts with the resulting events. The same command ID and payload returns the original receipt without spending again; the same ID with different content is rejected. Only one terminal observation advances an operation's frame. Duplicate callbacks are acknowledged; conflicting callbacks create reconciliation records. Late responses after cancellation may settle usage and artifacts but cannot resurrect the run.

One serialized writer command loop loads current state, decides, commits, then replaces the in-memory projection and publishes the committed cursor. Failed transactions change neither projection nor dispatch state. Expensive evaluation runs outside transactions and returns with the version/fingerprint it examined. Bound pending observations and work queues.

Keep core state limited to active aggregates and checked dependencies. Page completed histories through queries. Reconstructing one run must not require loading all workspace events or artifacts.

### Modules and import boundaries

Begin as one package with directory-level boundaries. Split published packages only when a real independent consumer exists. The tree below is a target map: create a module only when its active slice needs it, and keep closely related initial logic together rather than scaffolding every file.

```text
src/
  core/
    ids.ts                  # persistent/run/version identities
    model.ts                # immutable definitions and public interfaces
    contracts.ts            # bounded contract language and obligations
    graph.ts                # composition AST and structural wire/test grammar
    graph-check.ts          # typing, effects, export compatibility
    runtime-state.ts        # run tree, statuses, ledger projections
    decide.ts               # command/observation admission
    evolve.ts               # event application
    revisions.ts            # relation edits and version checks
    evidence.ts             # cohorts, consistency, assurance labels
    composition-state.ts    # persistent semantic projection and bounded views
    invalidation.ts         # reverse-dependency suspension decisions
  codecs/                   # persisted/input schemas and schema versions
  runtime/
    interpreter.ts          # durable graph execution machine
    scheduler.ts            # bounded queues and worker admission
    supervisor.ts           # explicit child join/cancel/accounting
    services.ts             # Effect service contracts
    recovery.ts             # interrupted-operation reconciliation
    application.ts          # command/query/subscription API
  storage/
    sqlite.ts
    migrations/
    repositories.ts
    artifacts.ts
  adapters/
    models/
      gateway.ts
      fake.ts
      pi.ts                 # if accepted in M3
    tools/
    sandboxes/
  shards/
    fixtures/               # finite normalization/composition examples
    coding/                 # first useful task family
    composers/              # graph planners and relation builders
  evaluation/
    runner.ts
    datasets.ts
    reports.ts
  cli/
    main.ts
    commands/
  tui/
    app.tsx
    views/
    components/
    view-models.ts
tests/
  core/
  runtime/
  integration/
  recovery/
  tui/
fixtures/
  tasks/
  provider-responses/
  histories/
```

Core must not import runtime, adapter, storage, CLI, or UI modules. CLI and TUI call the same application API. UI state contains selection, focus, filters, and draft input; canonical execution state belongs to the runtime.

Effect fibers, references, queues, and scopes are implementation resources. They are never the durable identities of shards or the persisted representation of a graph.

### Persisted programs and the formal monad

The mathematical free monad contains continuation functions. Do not try to serialize JavaScript closures or Effect values.

Implement a closed, serializable graph AST with explicit execution frames: graph/version reference, node position, input artifact references, continuation frames, pending operation IDs, owned child IDs, and exact dependency manifest. This is a concrete implementation of the supported computational fragment.

Built-in agent leaves are versioned state machines. Persist the transcript, tool-call state, step counter, model configuration, and pending operation; reconstruct execution from those values. Arbitrary user-supplied JavaScript continuations are outside the initial durable API.

Record the interpreter/frame schema version and each leaf's executable implementation identity or package digest. A definition ID must resolve to the implementation actually used, not whichever function currently has that name. After an upgrade, retain compatible implementations or reject affected resumption explicitly; event inspection can remain available even when execution cannot resume.

Keep a small pure reference interpreter for generated bounded programs. Compare the production machine's projected observations against it. Monad/associativity tests normalize administrative identifiers and retain explicit scope boundaries, observable effects, outcomes, and costs. A test must not mistakenly require inlining an agent scope to equal a scoped call.

### Canonical record encoding

Define one versioned encoding for hashed records: stable object-key ordering, preserved array order, explicit schema version, bounded finite numbers, and decimal strings for integers outside JSON's safe range. Reject functions, `undefined`, and nonfinite numbers. Hash canonical bytes with SHA-256. Mutable admission status remains outside immutable content; include timestamps only when they are part of the claim. Equal hashes identify equal encoded content, not every semantically equivalent program.

## 4. Runtime services and invariants

Use narrow Effect service interfaces for:

- `EventStore` and `StateRepository`: atomic event/projection/intention transactions.
- `ArtifactStore`: content-addressed reads/writes and verified references.
- `ModelGateway`: normalized model streaming and terminal outcomes.
- `ToolExecutor` and `SandboxManager`: approved operation execution.
- `Clock` and `IdSource`: controllable boundary inputs.
- `Evaluator`: versioned verifiers with explicit access boundaries.
- `RuntimeQueries`: run, graph, evidence, and cost projections for clients.
- `CompositionQueries`: scoped, revision-labelled views of persistent capabilities, relations, and pending composition work.

Implement these invariants before adding autonomous mutation:

1. Each child run has exactly one execution parent; governor identity is separate.
2. Returning from a parent does not publish success until owned children are accounted for.
3. An observed child failure may be handled; an unobserved child failure propagates in recorded spawn order.
4. Cancellation prevents new admitted effects, signals existing work, and records confirmed or indeterminate outcomes.
5. The default Effect scope/fiber behavior cannot silently replace these join rules.
6. Every model/tool attempt has an operation ID, bounded reservation, outcome, and attributed usage.
7. Spending is booked once; ancestor totals aggregate it without creating duplicate charges.
8. Runs pin exact definitions and a transitive allowed catalogue. Dynamic selection is confined to that catalogue.
9. A suspended dependency prevents new affected effects and successful closure under its old claim.
10. Graph publication is an atomic expected-version operation with commit-time dependency/status checks.

Use an explicit supervisor map keyed by `RunId`. Effect fibers execute admitted work and report observations. Domain state controls when a run is terminal. Do not mark a child complete merely because its fiber was interrupted.

Bound runnable operations rather than holding one worker permit for an entire subtree. A parent waiting on children must release execution capacity so those children can run. Use fair queues with separate model/provider concurrency limits, bounded pending work, and cancellation priority. Retry backoff must not monopolize an execution permit.

Use integer minor currency units for stored spending and integer token counts; round reservations conservatively. Record price-table version, provider/model, known usage, and any missing usage. A cancelled response with unknown billing is not zero cost. Depth, child count, model output tokens, wall time, and currency limits are separate controls.

### Unresolved usage and dispatch races

Retain unresolved usage as a liability against the original allocation instead of releasing its entire reservation. Authoritative later usage settles it once through an append-only adjustment. If provider/pricing bounds cannot support a monetary ceiling, reject that operation or use an explicitly configured alternative token/request policy; do not claim that an unenforceable hard currency cap is enforced.

Recheck admission under the command sequencer before committing an attempt for external dispatch. Revocation ordered earlier prevents dispatch; revocation ordered later cancels/reconciles the admitted attempt. This is the ordering boundary: a database transaction cannot undo acceptance by an external service.

## 5. Persistence and recovery

### Storage layout

Use an explicit workspace state directory, defaulting to `.government/` within the selected workspace. Add it to the generated workspace's ignore rules. Allow an explicit state-directory override. Configuration references credentials from the environment or a configured credential provider; secret values never become graph or evidence fields.

```text
.government/
  state.sqlite
  artifacts/<content-hash>
  workspaces/<run-id>/
  runtime.lock
```

M0 creates only the tables it needs. Grow the following schema through migrations:

| Table/group | Required information |
|---|---|
| `schema_migrations` | Applied migration identities and compatibility version |
| `events` | Sequence, event ID, aggregate/version, causal ID, payload schema/version |
| `command_receipts` | Workspace/command uniqueness, payload hash, committed outcome and event sequence |
| `shards`, `definitions` | Stable identity, governor, immutable implementation/contract references |
| `abstractions`, `admission_status` | Immutable claims and separate live status/reason |
| `graphs`, `graph_heads` | Immutable AST/hash and expected-version head |
| `dependencies` | Exact references, certificate dependencies, reverse traversal |
| `runs`, `run_frames` | Parent tree, pinned manifest, machine checkpoint, terminal outcome |
| `operations`, `outbox` | Intent, attempt, reservation, dispatch state, reconciliation state |
| `ledger` | Unique charges, reservations, allocations, usage provenance |
| `artifacts` | Content hash, media type, size, durable path, retention metadata |
| `cohorts`, `evaluations`, `evidence` | Dataset/verifier versions, samples, split, candidate identity |
| `proposals`, `receipts` | Origin, target/base version, obligations, checked fingerprint, decision |
| `continuous_state` | Step definition, state version, processed event cursor |
| `composition_checkpoints` | Revision, schema, event watermark, and indexed semantic-state roots |
| `composition_relations` | Exact participant references, relation kind, scope, bounded cohort summary, and supporting evidence/status references |

Use foreign keys, uniqueness constraints, WAL, a deliberate durability setting, and bounded busy handling. Keep one writer owner per workspace. A second active writer fails clearly; it does not independently recover or advance the same run. Read-only inspection can use separate connections.

Update event log, projections, operation intents, reservations, and revision heads in one transaction where they describe one transition. Do not emit UI success before that commit.

Artifact writes use temporary files, verified hashes, atomic installation, and durability handling before database references are committed. An orphan artifact can be garbage-collected; a committed reference to a missing artifact is an integrity error. Backup must include a consistent SQLite snapshot and referenced artifacts, not just a copy of a live database file.

### Compact shared composition state

The existing `.government/state.sqlite` is the local persistent file for this feature. Reuse the definition, graph, abstraction, proposal, and evidence tables; add a composition projection and indexes rather than another independent database or prose memory document.

Persist:

- Exact current graph references for workflow and harness-strategy heads.
- Task/interface indexes over available semantic capabilities.
- Reusable relation records: exact participants, relation kind, applicable task/environment scope, assurance reference, and bounded statistics within a single cohort.
- References to unresolved composition problems and proposals with their original base versions.
- Schema version, composition revision, and committed event watermark.

Keep transcripts, raw traces, evaluator samples, source trees, and run-local conversation state out of these records. Store their immutable references where they provide support. A record of a failed composition is scoped evidence or a search hint; it is not silently promoted to a universal prohibition.

Update the projection in the same transaction as the compositional facts it represents, including graph publication and suspension. Only compositional updates advance its revision. Startup restores it without a model call, reconciles later committed events, and checks live admission before use. A corrupt/stale projection is rebuilt from compatible canonical registry/event records; it is never replaced by a model's guessed summary.

Implementation targets:

- A root checkpoint descriptor of at most 4 KiB containing revision/cursor and index references; indexed semantic records are stored separately.
- A default model-facing view of at most 16 KiB of UTF-8 JSON and at most 32 summary records, also subject to the chosen model's context budget.
- Exact typed records, shared references, fixed-size counters, and bounded summaries. Page additional records by cursor or request their referenced fields; do not truncate a contract into a different meaning.
- Indexed lookup by task family, interface, participants, status, and scope. No embedding model is required to recover or search the basic composition state.
- Separate configurable quotas for composition records and bulky evidence/artifacts. If necessary support cannot be retained within quota, stop new affected collection/publication with an explicit storage-limit outcome rather than silently deleting support.

These are working-set and response-size limits, not a claim that unlimited knowledge fits in a fixed-size file. Total indexed storage grows with retained capabilities and relations. Measure root/view bytes, active metadata size, and artifact size separately. Binary compression can be added if measurements justify it; correct normalization and selective retrieval come first.

`CompositionQueries` returns records, exact references, revision/cursor, and an explicit omitted-count or continuation cursor. The planner can fetch more through `readComposition`; the runtime checker always resolves the full required dependency closure from storage. A bounded view cannot hide a required obligation from validation.

A new session selects from the restored composition state rather than rebuilding relationships from conversation history. Different planner adapters serialize the same semantic records into their own input format. Existing executor/model bindings and cohort-specific evidence remain pinned: changing the executor model may require new bindings and validation even though the shared knowledge is preserved.

Keep this layer independent of both per-run checkpoints and the continuous shard. M1 defines it, M2 establishes durable restoration, and M4 adds learned relational updates. M6's continuous shard becomes another reader/proposer against the existing shared state.

### Recovery rules

On startup, acquire exclusive writer ownership, validate schema/runtime compatibility, load projections/checkpoints, and reconcile pending operations before resuming work.

| Recorded state | Recovery action |
|---|---|
| Planned, not claimed for dispatch | Dispatch using the recorded operation ID and reservation. |
| Claimed/dispatched, outcome missing | Ask the adapter to reconcile by operation/external ID. If it cannot, preserve an indeterminate outcome. |
| Outcome persisted, continuation not advanced | Apply that recorded outcome exactly once to advance the frame. |
| Cancellation requested | Continue cancellation/reconciliation; do not restart the cancelled work. |
| Revision receipt persisted, commit uncertain | Read the graph head and revision transaction record; do not infer commit from the receipt alone. |

A crash can occur between an external service accepting a request and local acknowledgement. An outbox does not eliminate this ambiguity. Replay reconstructs state from recorded observations; it does not automatically rerun model calls or arbitrary shell commands. An explicit retry is a new attributed attempt with its own budget and policy decision.

For local subprocesses or containers, record enough adapter identity to reconcile surviving work. A bare PID is insufficient after restart because it may be reused. If reliable identity cannot be established, do not kill an unrelated process or claim the original action never happened.

### Writer ownership, retention, and compatibility

Verify an OS-held exclusive writer lock with a two-process test before enabling recovery. `runtime.lock` contains diagnostic identity; file existence or a stale PID alone is not ownership. Recovery cannot take over while the old writer still holds the lock. Resolve the platform binding before accepting M2.

Checkpoint projections with explicit reducer/schema versions. Decode historical events through versioned readers or upcasters without rewriting their original payloads or hashes. Resume only with compatible checkpoints, interpreter versions, definitions, and adapters.

Artifact collection follows reachability from active runs, pinned manifests, admitted abstractions, supporting evidence, unresolved operations, and retained receipts. Removing support first invalidates dependent claims; evidence cannot expire while its abstraction silently remains admitted. A retained hash alone is not inspectable evidence. Distinguish optional display logs from authoritative history and label missing optional material in the UI.

## 6. Contract and graph implementation

Implement a deliberately bounded contract language first:

- Named, versioned input/output schema references.
- Finite tag/refinement predicates and conjunctions.
- Declared capability and read/write footprints.
- Supported failure variants and operation bounds.
- Named verifier references, assumptions, and assurance provenance.

The initial checker supports schema compatibility, exact fact matching, finite-tag implications, declared refinement certificates, effect-bound comparisons, and known structural wiring. Unknown implications produce an explicit unresolved obligation. TypeScript assignability is not a proof of task semantics; a model's explanation is not a checked certificate.

Implement graph operators in this order:

1. `id`, exact `call`, and `seq`.
2. Structural `wire`, finite `route`, and `guard`.
3. Bounded `retry` with a restoration/idempotency witness.
4. `par` for independently isolated branches with an explicit join contract.

Each operator needs a schema, checker rule, effect bound, interpreter rule, persisted frame format, and conformance test. Do not merely add its TypeScript union case.

Graph predicates can only inspect declared tags or bounded metadata. Domain classification is a separate shard capability. For each admitted graph, store the derivation/obligation report, exact references, effect calculation, and assurance label.

Graph patches can add/remove nodes, change exact references, and rewire legal relations. They cannot rewrite primitive handlers, validators, policy, or lower-level source code. New capabilities may be registered as new definition versions through their own supported workflow, then selected by a relation patch.

### Graph versions and executable references

Compiling a revised graph creates a new definition/executable reference; exposing it creates a new abstraction version. Task aliases can resolve a new head at run start. Existing abstraction references never point indirectly to moving graph heads. Record refinement evidence when an export contract is preserved.

Reject cyclic definition-call references in the initial compiler. Introduce repeated execution through explicit bounded `retry`; the agent leaf's bounded step machine is separately versioned. Compile scoped subgraphs into private definitions before freezing the manifest. Broader recursive call support requires a later explicit implementation decision.

## 7. Provider, tool, and sandbox boundaries

### Model gateway

The Government model interface must represent:

- Explicit provider/model/configuration identity and capability requirements.
- A normalized message and tool-schema representation with provider-specific data retained where necessary.
- Streaming text/tool deltas and one terminal success/failure/cancellation outcome.
- Request/operation IDs, usage, pricing provenance, and partial-output status.
- Cancellation and deadlines without converting interrupted generation into success.
- Rate limits and retries as visible, budgeted attempts.

Keep provider-native types behind the adapter. Support a deterministic fake provider first, one real provider in M3, and a second only after the adapter contract is exercised. Model fallback changes provenance and, when relevant, the evidence cohort; it is never an invisible continuation of the old model configuration.

### Agent state and context management

Use explicit leaf states: `PreparingContext`, `AwaitingModel`, `AwaitingTools`, `CheckingResult`, and terminal outcome. Persist the inputs and pending IDs for each transition. Multiple tools execute sequentially first; parallel tool calls require the same independence checks as other effects.

Partial streamed arguments are display data. Dispatch only a complete, schema-valid tool call from a completed model response after recording its call IDs and checking authority. Retain provider-specific message blocks needed for continuation. A disconnect during arguments cannot execute half a tool call.

A versioned context policy assembles the task, pinned rules, explicit artifacts, committed messages, and bounded tool excerpts, reserving space for the next response. Begin with deterministic trimming of optional excerpts and artifact retrieval. Any later model-generated compaction records its source event range, algorithm/model version, summary artifact, retained blocks, and cost. Preserve unresolved obligations and tool-call/result pairing across compaction and restart.

Completion requires accounted-for calls and validated output. The end-to-end coding task additionally requires its independent evaluator's accepted result; a refactoring leaf can return a candidate patch to that evaluator. Step limits, repeated nonprogress, overflow, and failed context construction have distinct failure outcomes.

### Measurable harness variants

Record a versioned harness configuration with exact executor/model, planning strategy, action interface, context policy, and runtime profile references. Include these references in the run manifest and evidence cohort. Register a small authored set first; configuration changes create new executable identities rather than modifying a running leaf. Only variants with compatible interfaces, effects, and assurance may be selected by an admitted relation patch.

Start M3 with a fixed default and two single-component alternatives: an explicit planning scaffold versus direct execution, and deterministic context elision versus elision followed by bounded summarization. Evaluate each change against the same default before testing combinations. Add an action-interface comparison only when both interfaces have equivalent enforced authority and evaluator access. Record differences in diagnostics and edit tracking as part of the intervention; tool count alone does not describe it. Do not require a full Cartesian product or multiple paid providers.

The September 2026 harness study reports conditional benefits from planning, action interfaces, and context management across its tested models and budgets. Its staged elision/summarization result motivates an experiment, not a universal default. Its action-interface comparison also changes supporting checks. [An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/html/2609.20804v1)

For staged context management, use versioned soft and hard token thresholds: elide optional old tool bodies first, then summarize eligible older context only if necessary. Preserve pinned instructions, current task state, unresolved obligations, and complete tool-call/result relationships; reserve response capacity and retain authoritative source artifacts. If protected context cannot fit, report context-construction failure. Measure overflow, compaction cost, and retrieval use. Rare transcript recall in that study does not justify removing durable artifacts or shared composition knowledge.

### Initial tools

Start with bounded workspace reads, file listing/search, patch production, and execution of named evaluator/test commands. Tool arguments are decoded before execution. Large output is stored as an artifact with a bounded model-facing excerpt.

A model can request a child or a runtime profile only through typed tool operations mapped to Government commands. The parent passes a task spec, explicit input artifacts, and permitted context. Children receive fresh task context; no shared mutable conversation object is inherited from an upstream agent loop.

Fresh context does not mean a blank composition history. A child or harness with read authority can request a bounded view from the shared composition store. Reads do not grant invocation/publication authority; updates still follow typed observation or validated revision commands. Local session memories cannot overwrite shared semantic facts.

### Sandbox progression

M0–M2a use deterministic built-in fixtures and fake tools; no claim of hostile-code isolation is made for an ordinary process.

Before M3 executes generated code or repository tests, add one Linux container backend. Pin its image, isolate its workspace, constrain CPU/memory/process count/time, and make network access an explicit profile property. Keep provider credentials in the gateway process rather than the task container. A task profile cannot mount arbitrary host paths or a container-engine socket.

Use per-run disposable workspace copies initially, recording source revision plus any input dirty-tree snapshot hash. Git worktrees can be a later optimization when their shared administrative state is accounted for. Deliver a patch/artifact first; publishing it to the user's source tree is a separate explicit operation.

Two initial runtime profiles are enough: a bounded fixture profile and an isolated code-task profile. Add more backends or model routing choices only when a real task requires them. Runtime enforcement implements the declared profiles; string labels alone are not security boundaries.

### Concrete first coding task

Use a checked-in TypeScript fixture project with pure exported functions and pinned dependencies. Permit changes only to designated source files; preserve the public API, expected outputs, and specified error behavior. Produce a patch against the recorded source snapshot. Reject applying that patch to a changed base.

Build dependencies into the pinned image or provision them through a recorded setup action before task execution. Default evaluation requires no package download. Stage only permitted source changes into a fresh evaluation workspace made from the trusted baseline. Run type checks and the pinned evaluator there. Structured results identify the exact patch, source, image, and evaluator hashes; agent-authored logs or success claims are not acceptance evidence.

The first useful composition is `inspect task → refactor → independently verify → return patch and report`. Public-API or fast-path classifiers are separate capabilities. This supplies concrete M4 relation candidates among compatible refactoring strategies. Evaluator code and acceptance policy remain outside editable task artifacts.

## 8. CLI and TUI experience

The proposed executable is `government`. All interfaces call the same application commands and queries. The following commands describe the target interface and are not implemented yet:

```text
government init
government doctor
government run <task-type> --input <file> [--json]
government tui
government runs
government inspect <run-id>
government cancel <run-id>
government replay <run-id>
government graphs show <graph-ref>
government catalogue list
government catalogue validate <manifest>
government composition inspect [--task-type <type>] [--json]
government proposals
government proposals inspect <proposal-id>
government proposals validate <proposal-id>
government proposals apply <proposal-id>
government evidence <abstraction-ref>
government eval <suite> --candidate <definition-ref>
```

Introduce commands as their backend features ship. `proposals apply` invokes the same validation/commit protocol used by automatic promotion; it does not bypass checks. `replay` is read-only reconstruction from recorded events. A separate explicit command can create a new run using old inputs.

For noninteractive use, `--json` emits versioned JSON Lines on stdout, diagnostics on stderr, and documented exit codes distinguishing success, task failure, invalid input, interruption, and unresolved outcome. No terminal control sequences appear in machine output.

### Client protocol and exit codes

Use versioned envelopes for embedded calls and the later transport. Commands return durable receipts; queries return consistent snapshots with event cursors. Subscriptions deliver committed events after a cursor, deduplicated by sequence. Register and buffer the subscription before taking the snapshot, discard buffered events at or before its cursor, then catch up from durable storage. Missing retained cursors produce `ResyncRequired` and a new snapshot.

Initial exit codes: `0` command success (verified task success for `run`), `1` task failure or rejected mutation, `2` invalid input/configuration, `3` indeterminate task outcome, `4` runtime/storage integrity failure, and `130` user interruption. JSONL records include schema version and correlation ID. Graceful execution ends with one terminal record; EOF after a hard crash does not imply success.

The M6 socket lives in the owner-only state directory, admits the local owner, bounds message sizes, and negotiates protocol compatibility before accepting mutations. Client data cannot bypass the application validator.

### TUI layout

This is a post-M4 target, not an early research gate.

```text
┌ Workspace / run / status / budget ──────────────────────────────┐
│ Runs and owned shard tree │ Selected task / output / artifacts  │
│                           │                                    │
├───────────────────────────┴────────────────────────────────────┤
│ Output | Events | Graph | Evidence | Proposals                  │
├────────────────────────────────────────────────────────────────┤
│ Contextual commands, input, and status                          │
└────────────────────────────────────────────────────────────────┘
```

The first TUI needs run selection, the owned tree, streaming output, cancellation, and final artifacts. The interactive-client follow-up exposes the graph, evidence, and mutation backends already implemented by M4.

Show a proposal as its origin shard, target governor, before/after relations, base version, obligations, evidence scope, estimated bounds, and decision. Keep empirical admission visibly distinct from a checked proof. A user should be able to answer why a relation changed without reading raw model transcripts.

Use one event sequence cursor for subscriptions. A lagging TUI resynchronizes from durable queries; it cannot stall tool execution or drop authoritative state. Batch render updates, virtualize/bound long histories, and keep large artifacts out of the render state.

Add a composition-state inspector showing the restored revision, reusable relations, their scope/status, and pending composition work. Display compact view size separately from referenced artifact storage. Link records to evidence on demand rather than rendering that evidence into every session's initial screen.

### Process lifecycle

Initially the CLI owns an embedded runtime; the later TUI can own the same embedded runtime. Only that process may mutate its workspace database. `government tui` opens an interactive session; task entry starts work in that session. Separate inspection commands may read committed state. A separate mutation/cancel client reports the active owner until the local transport is implemented.

In embedded mode, quitting with active work requests cancellation and drains/accountably checkpoints owned work before exit. Terminal teardown must restore the user's terminal even on errors. A forced process kill is handled by recovery on the next start.

M6 adds a local runtime process and attachable clients through a versioned Unix-domain-socket protocol. The existing application API becomes its transport boundary. At that point closing a TUI detaches; cancelling a run is a separate command. Do not claim persistent background execution before this mode exists.

## 9. Evidence and mutation pipeline

### Evidence records

Follow the formal model's separation of persistent shard identity, definition version, run identity, and learning cohort. Persist the exact manifest, model/configuration, handler, evaluator, dataset split, and candidate hash.

Implement extraction and consistency as two separate stages:

1. A candidate generator reads discovery traces and produces a structured abstraction candidate and relation-patch proposal.
2. The candidate, feature map, verifier, scope, validation schedule, and error allowance are frozen.
3. Evaluation collects fresh eligible observations under that definition and cohort.
4. A deterministic policy evaluates the consistency criteria.
5. The child emits its supported abstraction and a mutation addressed to its governor.
6. Graph validation checks syntax, references, obligations, exported contract, scope, and resource limits.
7. Commit rechecks the base version and all status fingerprints atomically.

Use an authored candidate in the first fixture demonstration so runtime and validation bugs are not confused with discovery quality. Label it as authored. The subsequent milestone adds a model-driven candidate generator restricted to already registered capability references and the relation-edit grammar. A hard-coded candidate does not count as demonstrated abstraction discovery.

The initial automatic mutation surface is relational: selecting an eligible capability, inserting a classifier, changing a typed route, or replacing a composition strategy with a compatible one. Prompt rewriting and arbitrary source mutation are outside the initial surface.

### Evaluation before admission

An unpromoted candidate needs evidence before production admission. Implement `StartEvaluation` for a registered definition or staged graph, with a frozen manifest, evaluation-only grant, restricted sandbox, versioned verifier, and separate budget. The grant permits measurement, not publication or reliance on the candidate's proposed contract by production callers.

Evaluation is an owned shard run whose outcome is governed by the evaluator's contract. It records violations of the candidate's proposed contract rather than assuming that contract true. Existing production runs cannot expand their frozen catalogues to invoke it; start a new evaluation run. Consistency and relation checks still control subsequent promotion.

The evaluation host has its own admitted measurement contract and execution authority. It treats candidate outputs as untrusted data and enforces the sandbox/effect bounds independently. This avoids the circular requirement that a candidate prove its task contract before it can be measured. Structural decoding and execution-authority checks still apply to staged candidates.

A candidate record includes discovery event references, proposed interface/scope, exact capabilities, relation edits, a falsifiable benefit hypothesis, and evaluation-plan hash. Bound candidate count and aggregate optimization spending independently of ordinary task spending. The generator cannot submit executable routing callbacks or validator replacements.

### Semantic classification and uncertainty experiments

Use ordinary versioned shard capabilities for narrow semantic observations such as `NeedsDecomposition`, `ContextMissing`, and `RepeatedFailure`. Return a declared tag or `Unknown`, with source references and estimator identity; retain probability vectors when available. TypeSafe's routing, retrieval, and trace-classification examples motivate this pattern, but its advertised speed and quality are not Government measurements. No TypeSafe dependency is required. [TypeSafe use cases](https://docs.typesafe.ai/concepts/use-case-map)

The [semantic decision contract](docs/tasks/semantic-decision-contract.md) specifies three separately versioned capabilities: applicability checking before inference, semantic estimation, and action selection under a budget-aware policy. Applicability declares task/language scope, required evidence, exact input projection and token limits. Unsupported or ambiguous scope and missing/oversized inputs return `Unknown` before inference; confidence cannot repair an applicability failure. Keep probability calculations inside registered capabilities and expose only declared finite action tags to route predicates.

Bind calibration to the exact model/tokenizer, question schema and ordered options, input projection, applicability policy, label semantics and dataset lineage. Preserve raw and calibrated probabilities, immutable artifact references and explicit uncalibrated status. Changes require new evidence or an explicit transfer certificate. Separate training, calibration fitting, policy selection and final assessment by task lineage; do not tune on reserved assessment. Structured output and proper-scoring-rule training do not establish domain calibration.

Prediction and action are separate records. The frozen action policy accounts for independently established eligibility, error consequences, action-benefit evidence and remaining allocation, including estimator and verification costs. Unknown benefit/cost estimates use the declared constrained policy or fixed fallback, never fabricated expected utility. Recheck admission and reserve allocation at dispatch through the runtime; even fallback must be authorized and affordable or stop explicitly. Durable observation and decision records reference the operation ledger, so restart cannot replay uncertain inference or actions.

A predictive tag may select among capabilities that all accept the current input. It cannot establish a stronger semantic precondition merely because its confidence exceeds a threshold. A restricted fast path still needs the classifier contract and assurance required by the graph checker, or a separately checked guard. `Unknown`, unsupported scope, and estimator failure use a compatible fixed fallback. Producing a classification grants no authority to change validators, grant tools, or publish a revision. The shard may originate a proposal only through the ordinary consistency and governance protocol.

After a real workflow tradeoff is demonstrated, a child may propose a compact selector trained from development traces. Compare the best fixed workflow, a deterministic rule, a conventional small classifier, and optionally a Laya-backed estimator on matched held-out tasks. Include labeling, training, failed candidates, calibration, input projection, startup/residency and serving in cost accounting. The selector's dependencies include calibration and action policy; ordinary admission, invalidation and measured-benefit gates still apply. Laya is an optional implementation candidate, not a new dependency or a reason to change the frozen repository comparison. The [offline decision runtime](docs/tasks/semantic-decision-runtime.md) now implements and tests the core checks and durable inference/recommendation records. Graph registration, atomic action dispatch and empirical calibration admission remain pending.

After the fixed-variant comparison works, test uncertainty-guided escalation as a separately budgeted experiment. Distinguish:

- Token-distribution entropy: optional provider telemetry about alternative next tokens. Record distribution coverage, tokenizer/model, decoding configuration, and aggregation method. Chosen-token log probability alone is not entropy; renormalized top-k probabilities are not full-distribution entropy. Missing telemetry is unavailable, never zero.
- Semantic entropy: uncertainty across sampled answers grouped by meaning. Record the sampling policy, grouping/verifier version, sample count, and total sampling/grouping cost. For structured outputs, use a declared task-specific equivalence rule; similar text or passing the same small test suite does not establish semantic equivalence.
- Observed nonprogress: repeated failed operations, unchanged relevant artifacts, and verifier failures. These provide a deterministic comparison policy that does not require probability access.

Semantic-entropy research distinguishes meaning variation from wording variation and studies detection of confabulations; it does not establish correctness from low entropy or validate an arbitrary coding workflow. [Farquhar et al., Detecting hallucinations in large language models using semantic entropy](https://www.nature.com/articles/s41586-024-07421-0)

Freeze estimator, thresholds, scope, action choices, and calibration data before assessment. Compare against both the fixed strategy and simple nonprogress-triggered escalation. Measure whether extra retrieval, independent verification, or a stronger admitted executor improves verified outcomes enough to cover its cost. Preserve the final evaluator regardless of confidence. Escalation follows declared graph edges within the frozen catalogue and remaining allocation; it cannot silently switch the model of an existing leaf. Record the selected child definition and its own cohort.

Uncertainty may prioritize discovery or additional checks. It does not replace fresh consistency evidence, satisfy unknown proof obligations, waive independent evaluation, or authorize promotion. Keep randomly scheduled assessment separate from uncertainty-selected cases so the selected sample is not misrepresented as the deployment distribution.

### Sampling and assurance

Use disjoint discovery and validation splits. Define task strata, at least two fixed validation windows, sample counts, feature-distance thresholds, success thresholds, and an error allowance before observing outcomes. Use the formal model's confidence bound only when its sampling assumptions hold.

A small development suite can show correctness on its listed cases without earning a statistical generalization claim. Budget and sample requirements may leave a candidate unpromoted; do not lower the criteria after seeing its results. Cheap finite fixture domains can use exhaustive checks for explicitly bounded claims, labelled with that scope.

A reference feature map can include normalized operation/delegation patterns and public outcome categories. Similar prose or repeated final answers are not enough to establish semantic consistency. Version the feature extractor and verifier independently.

Maintain a final assessment split separate from discovery and repeatedly consulted promotion data. Results fed back to a generator are no longer untouched assessment data. Record task/source lineage so near-duplicate tasks do not cross splits unnoticed. Choose sample counts, candidate-comparison rules, and error allowances before observing outcomes; record them in the evaluation manifest.

### Refinement and invalidation

Store explicit forward and reverse dependency edges for graph references and evidence support. New versions do not replace old references automatically. A replacement must accept the old input scope, preserve required outcomes/invariants, and fit the dependent graph's effects and assurance requirements.

A contradiction suspends the affected claim according to its assurance policy. Propagate suspension transitively, prevent new affected work, and accountably cancel active affected runs as specified by the model. Preserve historical records. Revalidation, a narrowed new abstraction, or an explicitly checked fallback revision can restore admission.

Exercise simultaneous child proposals: one commit wins the expected-version check; the other becomes stale and must be rebased and revalidated. The parent is never partially updated and a stale receipt never authorizes a different graph.

## 10. Milestones and acceptance gates

Implement the research sequence in the order stated above, dividing each milestone into the bounded development slices defined in section 11. Each milestone ends with an executable demonstration and recorded checks. These gates determine readiness; calendar estimates should follow M0–M1 measurements rather than assume the integrations are already proven.

### M0 — Offline CLI vertical prototype

Deliver:

- Minimal package, strict compiler settings, formatter, lockfile, and proposed module boundaries.
- Verified Effect/Bun/test-runner dependency set.
- A fake model that streams a deterministic response, with cancellation and a terminal outcome.
- One application API exposed through `government run` and saved-run inspection, with JSON output suitable for later clients.
- SQLite event persistence for a single run and a query showing the saved outcome.
- A fake `ModelGateway` contract that does not depend on an external agent runtime; real provider selection waits until M3.

Acceptance:

- The fake task runs through the CLI without a model key and produces one attributable terminal result.
- Cancelling a stream produces a cancellation outcome and restores the terminal.
- A clean restart reads the saved run.
- Type checking and deterministic tests run through documented commands.
- Repeating `init` does not duplicate bootstrap identities or overwrite configuration.

Do not build the full registry, learning pipeline, or plugin system in this milestone.

### M1 — Semantic core and owned execution

Deliver:

- Identity/version types, run states, command/event unions, and pure decision/reduction functions.
- Graph AST and checks for `id`, exact `call`, `seq`, `wire`, finite `route`, and `guard`.
- Detailed contract/effect composition for the bounded predicate fragment.
- Durable graph frames and explicit child supervision.
- Shared composition-state schemas, projection rules, indexes, and bounded query selection independent of session/model-adapter identity.
- A ledger with reservations, unique attempts, inclusive totals, depth/child/token/time limits.
- The finite record-normalization fixture from the formal model, using registered deterministic capabilities.
- CLI owned-tree, outcome, and event inspection.

Acceptance:

- Generated legal sequential graphs agree with the reference interpreter.
- An invalid interface edge or undeclared routing callback is rejected before execution.
- A parent returning before a child finishes joins it; an unobserved failure propagates.
- Explicitly handled child failure permits the parent to continue under its contract.
- Simultaneous children cannot both spend the same remaining allocation.
- Every operation and graph leaf resolves to its recorded version.
- Repeating a command neither spawns nor charges twice; a conflicting payload is rejected.
- Children can finish with a single runnable-operation permit while their parent waits.
- Shared composition views preserve exact relation/scope references and respect the byte/record budget with explicit continuation metadata.

### M2 — Durable recovery and revision infrastructure

Deliver:

- Atomic events/projections/outbox, artifact installation, schema migrations, and writer ownership.
- Startup reconciliation for every pending-operation state.
- Graph/proposal/receipt persistence, exact manifests, and atomic expected-version commit.
- Reverse dependencies and suspension propagation, initially exercised with authored evidence.
- Bounded `retry` interpretation and persisted attempt frames, exercised with restoring fake operations.
- Read-only replay and artifact inspection in the CLI.
- Durable composition checkpoints and the composition inspector, available before any continuous-shard implementation.

Acceptance:

- Kill/restart at intent creation, dispatch, response receipt, and continuation advancement; no external effect is silently duplicated.
- Unknown external outcomes remain distinguishable from success and zero usage.
- Two competing revisions cannot both commit against the same base head.
- A contradiction arriving after validation but before commit invalidates the receipt.
- Missing artifacts or unsupported persisted schema versions stop affected recovery with an attributable error.
- A second writer cannot recover or mutate the active owner's runs.
- Late/conflicting responses cannot advance a frame twice or resurrect a cancelled run.
- Revised graphs receive new definition references; old abstractions retain their original programs.
- A retry respects its attempt limit, receives a new attempt ID, and preserves the restoration witness and combined ledger across restart.
- Close the process, start a new session with empty conversations and a different fake planner adapter, and recover the same workflow/composer heads, semantic relations, and pending proposal references without a model call.
- The seed root descriptor remains within 4 KiB and default views within 16 KiB/32 records as unrelated history grows; full records remain fetchable and admission checks remain complete.

### M2a — Offline child-mutation experiment

Deliver a small end-to-end use of the normalization example before the live coding task. Freeze the finite fixture domain and authored candidate, evaluate it exhaustively within that scope, create an evidence-backed abstraction, and have its origin shard propose a typed route to its governor. Use the existing M2 revision transaction and record the demonstration policy; the fixture does not need a discovery model or statistical generalization claim.

Acceptance:

- The baseline and revised graph preserve the declared fixture contract; record operation counts and observed runtime without presenting synthetic savings as coding improvement.
- The child-originated proposal passes evidence and relation checks, commits, and changes a subsequent run. A run started earlier retains its original manifest.
- A false classifier guarantee or incompatible precondition prevents admission; stale receipts and counterevidence prevent commit through the same production checker.
- Restart with empty conversations restores the accepted relation and pending records. Revoking supporting evidence suspends dependent admission.
- CLI output links the origin, evidence, before/after graph, decision, and subsequent execution without relying on prose transcripts.

This stage implements the minimal finite evidence policy and proposal plumbing needed here; M4 extends them to sampled coding evidence and model-driven discovery. Report whether the mechanism works, where implementation effort accumulated, and the next experiment's bounded scope. Do not start M3 while these gates fail. A passing fixture establishes the mechanism only.

### M3 — First useful isolated agent task

Deliver:

- One production model adapter, with fake/recorded fixtures for its error paths.
- A bounded agent loop as a persisted leaf state machine.
- One isolated code-task backend and typed workspace tools.
- First useful task family: a small TypeScript module refactor with unchanged specified behavior, a patch artifact, and independently executed checks.
- A baseline single-agent strategy and a composed strategy using the same model/tool budget policy.
- A small registered set of harness variants and matched single-component comparisons as specified in section 7; record the default, selection split, and comparison manifest.
- Named test/evaluator definitions pinned outside the agent's mutable workspace.
- CLI task entry, streaming output, artifact references, and accurate known/unknown usage.

Acceptance:

- A task completes from the CLI and produces a reviewable patch plus test evidence.
- The agent cannot change the acceptance evaluator by editing its task workspace.
- Tool requests outside the granted profile are denied by the executor.
- Model/tool cancellation, malformed arguments, unavailable provider, rate limit, and test failure have explicit outcomes.
- A run can restart from persisted loop state without reissuing already completed tool operations.
- Optional live checks use a configured spend limit; the ordinary suite remains offline.
- Partial tool arguments never execute; restart preserves committed call/result pairing.
- A fresh evaluator checks the patch against its exact source and evaluator snapshot.
- A new planner-model session can use stored composition views; selecting a different executor model does not inherit the previous model's empirical admission automatically.

The M3 comparison report records verified success, total cost, latency, peak context, overflow, compaction calls, repeated unsuccessful actions, and termination reasons for each exact variant. Selection uses development/promotion data; freeze the best eligible fixed configuration before final assessment. An inconclusive result is acceptable and retains the default. This gate requires a reproducible comparison, not a positive improvement.

Generalize the task family only after one realistic end-to-end task works. Support for a second provider is a follow-up adapter test, not a prerequisite for the first task.

### M4 — Consistent child mutates its governor

Deliver:

- Cohort storage, discovery/validation datasets, verifier versions, and consistency reports.
- Extend the M2a mutation path to coding-task cohorts and promotion policy; retain the authored fixture as a regression case.
- Automatic proposal validation and commit under the configured policy.
- CLI proposal diffs and evidence/obligation reports suitable for the later TUI.
- A model-driven candidate generator that can propose a new relation among registered capabilities from discovery traces.
- Rejection reasons, counterevidence handling, stale-proposal revalidation, and checked fallback revisions.
- One candidate for scoped routing among compatible M3 harness variants, using task metadata or a registered semantic classifier. Record its applicability, fixed fallback, and falsifiable benefit hypothesis.

Acceptance:

- One supported child-originated relation patch automatically commits and affects a subsequent run.
- Existing runs retain their pinned graph and catalogue.
- An incompatible fast-path precondition or failed consistency gate prevents promotion.
- A forged checked receipt cannot bypass the runtime validator.
- Suspension reaches all dependent graph admissions and affected active runs.
- Authored-candidate success and model-discovered-candidate success are reported separately.
- A held-out comparison includes discovery/evaluation cost and does not relabel reused validation tasks as unseen. Compare the adaptive route with the best fixed eligible M3 configuration selected before assessment, as well as the original baseline.
- The routing experiment exercises `Unknown`, classifier failure, insufficient budget, and unsupported scope; each follows the declared fallback or explicit failure without granting new authority. Admission and measured-benefit decisions remain separately inspectable.
- Semantic selectors additionally satisfy the [decision-contract acceptance cases](docs/tasks/semantic-decision-contract.md#acceptance-cases-for-the-implementation-slice): no inference outside declared applicability, exact calibration dependencies, independent action eligibility, post-inference budget checks, stale-dispatch rejection and restart without replay. A saved prediction is neither a contract proof nor an execution grant.
- A staged candidate can acquire evidence through an evaluation-only run without becoming production-admitted.
- An accepted relation survives a new session without importing the original conversation. Counterevidence updates the shared view/status and dependent admissions while preserving the original evidence scope.
- The M3 coding family exercises candidate generation, evaluation, and publication decisions, not only the normalization fixture. An adaptive coding MVP additionally requires a supported coding relation to be promoted and used by a subsequent task.

M2a establishes the authored adaptation mechanism; M4 retains those regression gates. Its useful-task gates establish a local adaptive coding MVP when promotion is supported. If evidence is insufficient, retain the fixed coding harness and experimental pipeline with that limitation recorded. Synthetic-only promotion is not demonstrated coding improvement.

### Research outcome and continuation decision

At the first M4 assessment, publish a reproducible report with the frozen experiment manifest, exact candidate/comparator references, task-level results, costs, and the promotion decision. Distinguish four outcomes:

- **Mechanism failure:** ownership, recovery, evidence, or publication gates fail. Repair or simplify the implementation before making an adaptation claim.
- **No useful candidate found:** the bounded generator search produces no eligible relation. Report discovery yield and search cost; this does not establish that no useful relation exists.
- **Admissible but unhelpful or inconclusive:** a candidate meets contract requirements but fails the benefit policy or lacks sufficient evidence. Keep the fixed harness and record the measured limit.
- **Supported improvement:** the candidate meets both admission and the predefined benefit policy on the declared scope, and a subsequent run uses the accepted revision.

A negative result can complete the bounded research assessment, but cannot satisfy M4's successful coding-promotion/MVP gates. Track assessment completion and those acceptance gates separately. Continue with another experiment only with a specific changed hypothesis and fresh scope/budget; avoid indefinite tuning on the same assessment set. Reconsider external agent-loop reuse only if measured engineering effort identifies a separable bottleneck. M5 can test the recursive mechanism independently, but receives its own evaluation budget and cannot inherit a coding-improvement claim.

### M5 — Harness strategies compose and mutate upward

Deliver:

- Explicit separation of each harness's managed workflow and its own composition strategy.
- Typed composition-problem, candidate-patch, and checked-receipt ports.
- The `RouteComposer`/higher-governor example from the formal model.
- Composer-specific cohorts across multiple composition problems, separate from worker-task evaluations.
- A higher-level strategy revision selected through the same publication protocol.
- Inspection distinguishes execution ownership from governance relationships; expose it through the CLI and any implemented TUI.

Acceptance:

- A harness's own composition behavior earns an abstraction and originates a relation patch to its governor.
- The higher harness changes how it selects/composes planners, rather than merely changing a worker workflow.
- The same core graph grammar, evidence records, and revision transition are used at both levels.
- Worker success alone cannot satisfy the composer's consistency policy.
- A dependency invalidation can propagate from a lower capability through its supported higher-level admissions.

This milestone establishes the project's distinguishing recursive architecture in an executable bounded setting.

### Post-M4 product and operator follow-ups

These additions can proceed after reviewing the first M4 assessment if their practical value justifies the work. They are not evidence that adaptation improves outcomes, and are not prerequisites for the bounded sequential M5 example.

- **Interactive client:** verify the OpenTUI/React/Bun dependency set and native renderer, then implement the section 8 views over the existing application API. Check streaming, cancellation, resize, terminal cleanup, bounded histories, and CLI/TUI agreement before claiming interactive support.
- **Parallel graph operator:** add `par` only for independently isolated branches, with schema, checker, combined effects, durable frames, and join rules. Exercise failure/cancellation of one sibling while another is active, crash recovery, and rejection of unsupported shared mutation. Until then, reject `par` explicitly; sequential child calls still enforce ownership and budget accounting.

### M6 — Continuous shard and attachable local runtime

Deliver:

- One local runtime owner with a versioned command/query/event protocol over a Unix-domain socket.
- CLI/TUI clients that attach and reconnect using event cursors.
- Durable continuous-shard steps with event deduplication, state versions, and an action outbox.
- Minimal state: owner, goals, attention queue, evidence-backed capability estimates, and autobiographical events.
- Scheduled reflection within explicit budgets, using the same candidate and publication paths.
- Clear shutdown, detach, cancellation, and interrupted-runtime behavior.

Acceptance:

- Closing a client does not cancel a background run; explicit cancellation still works.
- Repeated delivery of an event cannot commit the same continuous step twice.
- A step definition upgrade requires state compatibility and starts the appropriate new cohort.
- The continuous shard records a measured capability change with evidence references.
- Restart resumes from committed state and reconciles the outbox; it does not merely reload a prose summary.
- Reconnection neither loses accepted commands nor repeats them; incompatible protocol versions cannot mutate state.

The continuous layer is added after task execution and mutation are useful. It has no special right to bypass contract, budget, or publication rules.

### M7 — Local release hardening

Deliver:

- Packaged Linux installation with the native TUI assets included and tested.
- Workspace initialization, diagnostics, backup/restore, migration, and recovery documentation.
- Bounded trace retention, artifact garbage collection, and large-history query/render handling.
- Distribution smoke tests and an explicit supported-platform matrix.
- A baseline/adaptation report and documented limitations.

Acceptance:

- A clean supported Linux machine can install, run the offline demo, open the TUI, and inspect a persisted run.
- Backup/restore preserves pinned definitions, evidence, receipts, and artifact integrity.
- Upgrading an existing state directory either migrates it correctly or rejects it without partial writes.
- Long histories do not require loading all events/artifacts into the terminal view.
- Core invariants and failure/recovery cases pass after packaging.
- Artifact collection retains support for active claims or explicitly invalidates affected claims before removing it.

## 11. Verification and evaluation

### LLM development workflow

Use spec-driven vertical slices with test-first development for the semantic core. Each slice implements a small observable behavior through the layers it needs. Translate the relevant part of the formal model into acceptance cases just before implementing it; do not generate the entire project's test suite or speculative interfaces up front. Keep the CLI/fake-provider path runnable as successive milestones extend it.

The formal model supplies intended semantics, this plan supplies delivery order, and executable acceptance cases connect them to code. Tests are evidence about the implementation, not a proof that the specification or its translation is correct. Resolve contradictions explicitly and update the affected specification, acceptance cases, and implementation together.

Use this loop for each slice:

1. **Inspect and scope.** Read the relevant formal-model sections and existing code. Choose one behavior with a clear completion boundary; record dependencies and exclusions. If a library capability is uncertain, resolve that question in a bounded experiment before fixing the integration design.
2. **Define acceptance.** Write input/outcome examples, invariants, invalid transitions, and applicable failure/recovery cases. Review their expected results against the specification before coding. Specify observable results rather than private function names or internal object layouts.
3. **Establish failing checks.** For core behavior, write focused tests first and run them. Confirm failure comes from the missing behavior, not an unrelated import, fixture, or environment error; minimal type/interface scaffolding is acceptable. Add generated properties once the operation and observation boundaries are clear.
4. **Implement and refactor.** Complete the smallest working path, keeping domain decisions pure and effects at interpreter/service boundaries. Run focused checks while iterating, then refactor with those checks green. Avoid unused extension points and speculative generalization.
5. **Review the oracle and code.** Use a separate review pass, preferably with fresh context, to challenge assumptions in both the tests and implementation. Review against the source semantics, not just the implementation diff. Resolve findings and rerun affected checks.
6. **Demonstrate and record.** Run the slice's required checks and executable scenario, then the implemented offline gate before declaring completion. Record commands, results, remaining limits, and the next dependency. A skipped prerequisite cannot satisfy acceptance.

### Choosing the verification method

| Work | Development approach |
|---|---|
| Pure semantics, contracts, effect bounds, and revision rules | Test-first concrete examples, then property tests and bounded reference-interpreter comparisons |
| Scheduling, ownership, budgets, and admission | Test-first state-machine scenarios; generated command sequences and controlled interleavings as the implementation grows |
| Persistence and recovery | Acceptance scenarios first, implemented against real temporary SQLite databases; inject failures at transaction and dispatch boundaries |
| Effect, provider, and native TUI integration | Small compatibility experiment with an explicit question and exit criterion, then behavior/conformance tests around the selected adapter |
| CLI/TUI interaction | End-to-end command and interaction scenarios plus actual terminal inspection; snapshots only where they protect meaningful stable output |
| Mutation quality | Frozen candidates, evaluators, and task splits with measured baseline comparisons; unit tests verify promotion machinery, while evaluations assess improvement |

A compatibility experiment ends with a recorded supported behavior, dependency decision, and limitation or rejection. Replace exploratory shortcuts before accepting production behavior. It does not waive cancellation, persistence, or other milestone requirements. Tests for core logic should inject time, IDs, and adapter outcomes; database and process semantics require the real infrastructure under test rather than mocks that assume those semantics.

### Slice task and session handoff

Create one short task record per active slice under `docs/tasks/` when implementation begins. Keep it current rather than duplicating the full plan. Use the following fields:

```text
Slice / milestone:
Status: planned | implementing | verifying | complete | blocked
Behavior and scope:
Relevant spec and plan sections:
Dependencies and exclusions:
Acceptance examples and invariants:
Failure / restart cases, or why they do not apply:
Required checks and runnable demonstration:
Results: exact commands, outcomes, skips, and relevant artifact paths
Open issues / next step:
```

The coding session reads this task, the relevant source sections, and the code it will change. Start a new session at a coherent boundary with this persisted handoff; do not rely on conversation history to carry implementation decisions. Keep repository-wide instructions short: architectural boundaries, actual verification commands, and links to authoritative documents. Introduce commands only when they execute real checks.

Completion requires all acceptance cases to be addressed, applicable checks to pass, review findings to be resolved or explicitly deferred outside the slice, and the demonstration to work. An unresolved issue that violates acceptance keeps the slice open. Record scope or semantic changes with their rationale; do not weaken an assertion, delete a failing case, or substitute a stub merely to obtain a green result.

### Example: durable command deduplication

Within M2, assuming M1's command identity and owned-run behavior, scope one slice to deduplication across restart:

- The same command ID and canonical payload creates one child and returns the recorded command outcome on repetition.
- The same command ID with a different payload is rejected without creating another child or reservation.
- Repeating the command after restarting against the same database preserves that behavior.
- A crash before the transaction commits leaves no partial command/child/reservation state; a crash after commit but before replying lets the repeated command recover the committed outcome.
- Planned operation identities and budget reservations are not duplicated. External delivery and ambiguous external side effects retain the separate reconciliation rules; command deduplication alone does not promise exactly-once external execution.

Check persisted state and public command outcomes, not only mocked repository calls. This slice extends M1's in-process cases with real database/restart evidence rather than rewriting them.

### Independent review and test strength

Before accepting a critical slice, check whether its tests could pass with a plausible broken implementation. For deduplication, temporarily bypass the duplicate check; for admission, bypass the expected-version check. The relevant test must fail, and the deliberate defect must be removed before the final checks. Use targeted fault experiments for critical invariants rather than making a full mutation-testing framework an M0 prerequisite.

Keep the reference interpreter simpler than the production machine and independently express expected outcomes; copying production transitions into a test oracle reproduces the same bugs. Property tests must exercise meaningful generated programs and preserve failing seeds and minimized cases. They do not establish laws beyond the supported fragment and observation model. A fresh LLM review can find omissions but is not an independent correctness guarantee, and cannot replace execution or a trustworthy evaluator.

### Verification coverage and commands

Use tests for behavior that can violate the model. Avoid tests that merely repeat constructors or snapshot every internal representation.

| Layer | Verification |
|---|---|
| Pure model | Exhaustive small examples and generated command sequences for ownership, budgets, contract checks, revisions, and invalidation |
| Algebra/interpreter | Identity/associativity and reference-machine comparisons on bounded supported programs |
| SQLite/recovery | Real temporary databases, actual transactions, migrations, conflicting writers, and injected crash boundaries |
| Delivery | Duplicate/conflicting command IDs, late responses, out-of-order stream fragments, and subscription catch-up races |
| Shared composition state | Cross-session restoration with empty conversations, different planner adapters, bounded views, complete checker lookups, and preserved cohort/status distinctions |
| Adapters | Recorded provider responses and fake tools for cancellation, malformed calls, rate limits, missing usage, and uncertain completion |
| Isolation | Attempts to exceed the implemented workspace/network/process profile and evidence that the executor enforces it |
| CLI | Exit status, JSONL schema, stdout/stderr separation, missing configuration, and recovery diagnostics |
| TUI | Keyboard focus, resize, streaming updates, selection, terminal cleanup, and reconnect/cancellation semantics |
| Adaptation | Fixed baseline versus fixed composition versus adaptive composition, with all optimization costs included |

Inject time, ID sources, scheduling decisions, and adapter outcomes in the test harness. Store generated-test seeds and minimized counterexamples as fixtures. Keep native process-kill tests in a separate integration command so ordinary core checks remain fast.

Proposed development commands; introduce each test command when its suite exists, beginning with type checking, lint, core tests, and the offline demo in M0:

```text
bun run typecheck
bun run lint
bun run test:core
bun run test:integration
bun run test:recovery
bun run test:tui
bun run check
bun run demo:offline
```

`check` runs type checking, lint, and all implemented deterministic offline suites. Establish Linux CI in M0 and extend it with temporary-database recovery tests in M2 and container integration in M3 and TUI integration in the post-M4 follow-up. Keep live-provider checks separate with explicit credentials and spend limits. An unavailable integration prerequisite is reported as skipped and cannot satisfy its milestone gate; do not create passing placeholder scripts for unimplemented suites.

### Evaluating adaptive behavior

For adaptation, record:

- Success under the named verifier and the exact evaluation scope.
- Total cost per verified successful task, including failed tasks, candidate generation, validation, and reflection.
- Latency distribution and cancellation/recovery outcomes.
- Regression counts on previously supported cases.
- Acceptance/rejection rates and reasons for proposed mutations.
- Composer validity measured independently of worker success.

Use the same task inputs and comparable model/resource policies for baseline comparisons. Repeat stochastic evaluations only under a declared schedule. A negative result is useful: keep the fixed harness if adaptation has not earned its cost.

### Comparison protocol and learning cost

Freeze task lineage/splits, exact variants, evaluator, resource ceilings, repetitions, candidate limit, and comparison rule before collecting assessment outcomes. Run strategies on matched inputs in fresh isolated workspaces; randomize or balance execution order when service variability matters. Record actual model usage and provenance rather than assuming equal token limits imply equal cost. Use a predefined primary objective, such as lower total cost subject to a declared success-rate noninferiority margin, and report uncertainty with task-paired comparisons. Choose margins and statistical rules before observing outcomes; insufficient evidence does not earn a benefit claim.

Select the strongest eligible fixed comparator on development/promotion data. Keep final assessment untouched until both that comparator and the adaptive candidate are frozen. Reusing assessment feedback creates a new development source and requires fresh assessment for a subsequent claim. Report per-task-family and executor scope; pooled averages cannot silently extend admission to unmeasured strata.

Report operational cost separately from total experimental cost. The latter includes candidate generation, classifier calls, sampling, grouping, failed candidates, evaluation, and reflection. Give both the unamortized result at the measured task count and any amortized projection with an explicit reuse horizon. Where recurring savings are positive, estimate the number of future tasks needed to recover optimization cost; label that estimate as conditional on the measured task distribution persisting. Zero verified successes leaves cost per verified success undefined, not zero.

For the first routing experiment, compare the original baseline, the selected fixed variant, and the adaptive route. Add uncertainty-guided routing only as a later comparison against that same fixed strategy and a simple nonprogress rule. A relation may be contract-admissible without earning a measured-benefit claim. Record a separate deployment decision under a versioned benefit policy, bound to the exact candidate, comparator, scope, and evaluation manifest. Automatic production promotion requires both this decision and the existing admission receipt; commit rechecks their identities and policy versions. Authored mechanism fixtures may use an explicitly labelled demonstration policy without claiming measured improvement. Retain the fixed harness when the adaptive alternative has not met the production benefit policy. Do not alter consistency criteria to manufacture improvement.

## 12. Formal-model traceability

| Formal-model section | Implementation location | First completion gate |
|---|---|---|
| 1: identities and contexts | Core IDs, definition schemas, governor and execution-parent projections | M1 |
| 2: execution monad | Reference interpreter and explicit operation language | M1 |
| 3: operational semantics | Supervisor, scheduler, run frames, ledger, recovery | M1–M2 |
| 4–5: semantic composition and effects | Contract checker, graph rules, effect algebra | M1; bounded retry in M2; isolated parallelism after M4 assessment |
| 6: abstraction boundary | Catalogue schemas, restricted test/wire grammar | M1–M4 |
| 7: evidence and consistency | Cohorts, fixed policy, evidence transfer and contradictions | M2a finite policy; M4 sampled coding evidence |
| 8: composition of composition | Harness strategy definitions and composer-specific evaluation | M5 |
| 8: persistent composition state | Shared semantic projection, indexed references, bounded views, and restart restoration | M1–M2; learned relations in M4 |
| 9–10: publication and invalidation | Revision transactions, receipts, exact manifests, reverse dependencies | M2 infrastructure; M2a authored mutation; M4 learned coding path |
| 11: domain mutation example | Normalization fixture and child-governor integration test | M2a |
| 12: higher-harness mutation example | Route composer fixture and upward revision test | M5 |
| 13: continuous shard | Durable step/outbox scheduler and attachable runtime | M6 |

Unsupported operators or assurance forms must be rejected explicitly. The implementation should never accept the entire formal vocabulary while silently giving some operations weaker semantics.

## 13. Risks and concrete responses

| Risk | Response |
|---|---|
| Building a large framework before it executes a task | M0 ships an offline CLI prototype; M2a demonstrates mutation before live coding or UI work. |
| LLM-generated tests and implementation share a mistaken interpretation | Review acceptance examples against the formal model, use simple reference semantics and targeted fault experiments, and require an executable demonstration. |
| Passing checks conceal weakened requirements or incomplete work | Record acceptance changes and their rationale; keep skipped prerequisites and unresolved acceptance failures visible in the slice task. |
| Effect lifecycle differs from shard joining | Keep domain-owned statuses and supervisor logic; test child completion and cancellation explicitly. |
| Durable state accidentally contains closures | Store only schema-validated AST, frames, transcripts, references, and operation records. |
| A contract checker becomes an attempted general theorem prover | Restrict the predicate fragment; require explicit support for unknown obligations. |
| Upstream provider APIs drift | Pin versions, maintain adapter conformance fixtures, and keep provider types private. |
| TUI/native packaging consumes early effort | Defer the renderer until after M4 assessment; retain a working headless CLI throughout. |
| Replaying a run repeats a side effect | Separate read-only replay, reconciliation, and explicit new attempts. |
| Improvement appears only because evaluation changed | Freeze verifier/candidate/splits and keep assurance labels and revision provenance. |
| Every new version fragments evidence | Retain discovery history but transfer validation evidence only through recorded claim-specific justification. |
| Higher-level recursion is only renamed workflow nesting | Require M5's composer-specific inputs, outputs, history, and upward strategy mutation. |
| Event persistence or rendering blocks streaming | Bound transactions and UI buffers; batch deltas and store large output as artifacts. |

Defer hosted services, distributed scheduling, multi-tenant administration, arbitrary plugin execution, model training, unrestricted source self-rewriting, multiple sandbox vendors, and a web UI until the local milestones establish a need. This plan implements functional composition and relational adaptation without making those additional systems prerequisites.

### Deferred research and preview adapters

Cache-to-Cache uses trained projection/fusion of internal KV representations and model/tokenizer alignment. Its reported experiments motivate a future specialized executor, not a replacement for portable semantic records. Any experiment must pin both models, fusion weights, alignment, runtime, and artifact formats as one executable implementation, with a separate evidence cohort and measured communication cost. It requires access to model internals and is outside the initial provider adapter and local milestones. Durable structured inputs and composition records remain authoritative; discarding an optional cache must not erase the only recoverable task state. [Cache-to-Cache: Direct Semantic Communication Between Large Language Models](https://arxiv.org/html/2510.03215v1)

Cloudflare Quick Tunnels can later expose a task application's preview or receive external test callbacks. Treat a tunnel as an explicitly granted public-exposure operation owned by the run, with recorded process identity, endpoint, lifetime, cancellation, and restart reconciliation. Expose only the designated preview service; runtime mutation APIs require their own authenticated boundary. Add this adapter when a web task needs it, without making network access or public previews an initial coding-task requirement. [Cloudflare Quick Tunnels](https://try.cloudflare.com/)

## 14. First implementation session

1. Create the first M0 task record with acceptance cases for a fake task, cancellation, saved-outcome inspection after restart, and terminal cleanup. Keep the scope to one offline CLI vertical prototype.
2. Run bounded Bun/Effect/SQLite/test-runner compatibility experiments, create only the package boundaries needed by this slice, pin the supported set, and record the choices.
3. Establish focused failing checks for the run transitions and saved-result behavior, then implement a deterministic fake provider and one `RunRequested → OperationPlanned → OperationObserved → RunCompleted` path.
4. Persist that path in a temporary/workspace SQLite database through the transaction boundary and verify it against a real database.
5. Expose it through `government run`, JSON output, and saved-run inspection.
6. Exercise cancellation and terminal cleanup, then restart and inspect the recorded outcome. This establishes M0's saved-result inspection, not M2's full crash-recovery guarantees.
7. Review the tests and implementation against the acceptance cases, run type checking and all implemented offline checks, and demonstrate the CLI run, cancellation, and saved-result inspection paths.
8. Record actual results and limits in the task handoff. Begin M1 only after M0's acceptance gate passes; apply strict test-first development to each subsequent semantic-core slice.

The next deliverable is that runnable offline prototype, followed by the smallest path to the M2a mutation experiment. The detailed formal model remains the source of invariants, and this plan provides the order in which to make them concrete.
