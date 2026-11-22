# Government: Computational Shard Formal Model

Version: 0.3 — specification with proof sketches

A computational shard is a semantic, effectful computation that owns an execution subtree. Its execution language forms a monad. Its semantic interfaces restrict which computations may be composed; ownership, resource use, and revision are explicit effects interpreted by a runtime.

A shard's persistent history supports semantic abstractions. When an abstraction becomes consistent under a declared evidence policy, the shard originates a mutation to its governor's relations among abstractions. Harnesses undergo the same process: both the workflows they manage and their own strategies for composing workflows can become abstractions at a higher level.

Composition has persistent state shared across sessions and model providers. It records reusable semantic interfaces, composition structures, and supported relationships independently of any shard's conversation or model-specific memory. Compact task views expose the relevant portion without loading the whole history.

This model defines the execution calculus, contract composition, restricted composition language, versioned evidence, revision transitions, and two worked mutations. The proofs are mathematical sketches, not mechanically checked proofs. The model distinguishes semantic truth, evidence-based admission, and measured usefulness throughout.

## 1. Objects, identities, and assumptions

Use distinct identities for distinct lifetimes:

| Symbol | Meaning |
|---|---|
| `sid` | Persistent shard identity across implementation revisions and runs |
| `did = (sid, v)` | Immutable definition version, including program and contract hashes |
| `rid` | One execution of an exact definition version |
| `aid = (sid, av)` | Immutable published abstraction version |
| `gid = (owner, gv)` | Immutable composition graph version |
| `eid` | Immutable evidence event or certificate |

A definition is:

$$
D=\langle did,T,X,A,C,e,P\rangle,
\qquad P:X\rightarrow M A.
$$

Here $T$ contains the task family and concrete semantic specification, $C$ is its contract, and $e$ is an effect bound. Concrete run input is recorded separately. A task description classifies intent; it does not identify an execution.

`execParent(rid)` owns the run and its resources. `governor(sid)` owns the composition structure that this shard may propose changing. They are different relations: a temporary caller need not be the governor of a reusable capability. Both relations are acyclic; every non-root member has one parent in the corresponding relation. Abstraction level is independent of execution depth.

A semantic context $K$ fixes the world interface, permitted environment transitions, shared invariants, observable events, and admitted failure behavior. For the categorical fragment, its invariant is a predicate on the complete relevant boundary state, is preserved by an empty computation, and its failure discipline is stable under prefixing by executions that preserve that invariant. History-sensitive restrictions must be represented in this state or in explicit interfaces. A concrete handler supplies typed transitions for primitive operations. Soundness statements below are conditional on that handler meeting its primitive specifications. In v0.3, sequential reasoning assumes an isolated relevant workspace or an environment whose permitted interference preserves the predicates used by the contract. Unrestricted shared-state parallelism is outside this fragment.

## 2. The execution monad

Let $\Sigma$ be a fixed, typed signature. For an operation instance $o$, let $R_o$ be its response type. Define the well-founded computation syntax:

$$
M A ::= \operatorname{Pure}(a:A)
\mid \operatorname{Op}(o,k:R_o\rightarrow M A).
$$

Operation arguments use data and immutable registry references. `spawn` takes a definition reference rather than embedding an unevaluated computation in the signature. Each instantiation of the typed signature is understood in a fixed universe of types. Host-language continuations in this mathematical syntax are total; arbitrary host-language effects are not permitted inside them.

```text
infer(request)                         → Result<ModelResponse>
invoke(toolRef, arguments)             → Result<ToolResponse>
readMemory(query)                      → Result<MemoryResult>
readComposition(query)                 → Result<CompositionView>
writeMemory(event)                     → Result<Receipt>
spawn(did, input, allocation)          → Result<ChildHandle<A>>
await(handle)                          → Outcome<A>
cancel(handle)                         → Receipt
fail(reason)                           → Never
requestRuntime(requirement)            → AllocationDecision
emitAbstraction(candidate)             → CandidateReceipt
proposeRevision(governor, patch)        → ProposalReceipt
commitRevision(checkedPatch)            → RevisionDecision
```

`Result<A>` is `Ok(A) | Err(Failure)`. `Outcome<A>` additionally includes cancellation and an indeterminate external-effect outcome. Receipt and decision types include their operation-specific rejection cases. A response may be delayed while an operation is pending. A denied request produces a typed failure, not the requested effect. `fail` has an empty response type and no returning continuation; it explicitly propagates a terminal failure through the scope-closing rules and is never denied as an unauthorized external action.

Define:

$$
\operatorname{pure}(a)=\operatorname{Pure}(a),
$$

$$
\operatorname{Pure}(a)\mathbin{\gg=} f=f(a),
$$

$$
\operatorname{Op}(o,k)\mathbin{\gg=} f
=\operatorname{Op}(o,\lambda r.\;k(r)\mathbin{\gg=} f).
$$

Then:

$$
\operatorname{pure}(a)\mathbin{\gg=} f=f(a),
\qquad m\mathbin{\gg=}\operatorname{pure}=m,
$$

$$
(m\mathbin{\gg=} f)\mathbin{\gg=} g=m\mathbin{\gg=}(\lambda a.\;f(a)\mathbin{\gg=} g).
$$

Left identity is definitional. Right identity and associativity follow by structural induction, with continuation functions identified extensionally. Define `map(f, m) = m bind (pure ∘ f)`.

This is a free monad over the signature. The algebraic-effects foundation separates programs from their effect handlers. [Plotkin and Pretnar, *Handling Algebraic Effects*](https://lmcs.episciences.org/705)

`bind` introduces no run, trace event, allocation, or revision. `pure` is an effect-free, degenerate computation. A task-bearing execution scope is created explicitly. Monad equality concerns computation semantics, not equality of physical duration or incidental implementation overhead.

## 3. Operational semantics and ownership

A runtime configuration is:

$$
\Omega=\langle W,\mathcal R,\mathcal D,\mathcal A,\mathcal G,L,Q,\tau\rangle.
$$

- $W$: relevant world state, including isolated workspaces and durable memory.
- $\mathcal R$: run table with current computations, statuses, and ownership.
- $\mathcal D$: immutable definition registry.
- $\mathcal A$: immutable abstraction records and their current admission statuses.
- $\mathcal G$: immutable graphs and mutable head pointers.
- $L$: resource ledger and granted capabilities.
- $Q$: queued events, pending operations, and revision proposals.
- $\tau$: append-only causal event history.

A run record contains:

```text
rid, did, input, execParent, childHandles,
currentComputation, pendingResult, status,
dependencyManifest, capabilities, allocation, localState
```

Statuses are `running`, `waiting`, `closing`, `cancelling`, and `terminal(outcome)`. A transition is written:

$$
\Omega\xrightarrow{rid:event}\Omega'.
$$

The scheduler interleaves enabled transitions. A maximal execution is a finite terminal/stuck execution or an infinite sequence of such transitions. Fairness is an additional assumption for liveness results, not for the safety results below.

### Transition rules

| Rule | Preconditions and transition |
|---|---|
| Start | An admitted exact definition and input create a fresh root run. Freeze its dependency manifest and initialize a bounded allocation. |
| Primitive request | For an externally dispatched primitive at `Op(o,k)`, check the live admission status, granted capabilities, arguments, and available resource reservation. Denial resumes `k` with its typed error. Admission records an operation ID and reservation before dispatch. Lifecycle and registry operations use their specialized rules. |
| Primitive response | A specified handler transition returns response `r`, updates the permitted part of $W$, records actual usage and outcome, and resumes `k(r)`. All possible handler responses are included in the semantics. |
| Spawn | Allocate a fresh child of the requesting run, pin its definition and dependencies, grant no more authority than the parent may delegate, reserve its budget within the ancestor allocations, and return its typed handle. |
| Await | For a nonterminal owned child, mark the caller waiting. When the child is terminal, deliver its outcome and mark that outcome observed. The caller may explicitly handle failure. |
| Cancel | Mark the target owned subtree cancelling, prohibit new effects, request cancellation of pending work, and record outcomes as they become known. Ownership is retained until closure. |
| Return | `Pure(a)` at the run boundary stores `a` and enters `closing`. It does not publish success while a child is nonterminal. |
| Close | Join all children and recheck live admission. If any child has an unobserved nonsuccess outcome, propagate the first in recorded spawn order. Otherwise publish `Success(a)` if admission remains valid; revocation follows the abort rule. Explicitly observed failures may have been handled by the program. |
| Runtime abort | `fail(reason)`, a budget stop, unhandled runtime failure, or revocation initiates subtree cancellation, followed by terminal failure once child and pending-operation outcomes are accounted for. |
| Revision | Proposal and commit follow the transitions in Sections 9–10. A revision never changes the code or manifest of an existing run. |
| Composition query | Check the caller's read scope and return a bounded view of the shared composition state at a recorded revision/cursor, with exact references and omitted-item indicators. Reading does not grant invocation or publication authority. |

No rule silently detaches a child. Thus `spawn(child)` followed by `pure(a)` joins the child at scope exit; it does not leak it. A child that cannot be terminated can keep its ancestor in `closing` or `cancelling`. A lost external response may be recorded as indeterminate once the adapter can account for the request without asserting that the external effect was reversed.

A run may access another run's result through an explicit communication interface, but this does not grant an ownership handle or cancellation authority.

Each charged external action has one ledger identity. Its cost is included in every ancestor's inclusive total but booked only once. Reservations consume available capacity; they are not additional actual spending. A provider or adapter must support enforceable request bounds for strict budget guarantees; otherwise its overshoot bound must appear in the allocation contract.

### Execution observations and satisfaction

Let $\operatorname{Exec}_K(P,x,w)$ be the set of executions starting with program $P(x)$ and relevant world $w$, under the context and transition rules above. Here $w$ is the contract-visible projection of the full configuration, including relevant ownership, ledger, and registry state as well as application state. Observations project executions to public results, failures, allowed world changes, resource use, and causal events. Fresh run identifiers are compared up to consistent renaming. Administrative scheduling steps are ignored unless the contract explicitly observes them. Observational equivalence for composition means agreement in every admissible continuation context, not merely equality of one run's final output.

A contract is:

$$
C=\langle Pre,Inv,Ok,Err,Live\rangle.
$$

`Pre(x,w)` is the entry condition. `Inv` is a prefix predicate. `Ok(x,w,a,w',τ)` and `Err(x,w,f,w',τ)` describe permitted successful and unsuccessful terminal observations. `Live` is either absent or an explicit liveness property with its required scheduler/environment assumptions.

Define $P\models_K C$ to mean: for every admissible input/world satisfying `Pre`, every execution in $\operatorname{Exec}_K$ preserves `Inv`; each terminal observation satisfies `Ok` or `Err`; and any declared `Live` property holds. Partial correctness alone permits nontermination. It does not establish a useful success rate.

For intermediate computations, the same judgement uses local return to a continuation as its endpoint, with any live owned children retained in the intermediate state and invariant. Root closure occurs only at an explicit run boundary. This distinction makes sequential `bind` reasoning agree with the scope rules.

## 4. Semantic shard composition

The complete metadata record is not an ordinary monad over arbitrary task specifications. The precise claim is: **semantic shard programs are contract-constrained arrows in the Kleisli category of $M$**. They have identities and associative composition when their interfaces and obligations match.

Fix context $K$. An interface is $I=(X,\phi_I)$, where $\phi_I(x,w)$ describes an admissible boundary state. Define:

$$
\mathsf{S}_K(I,J;e)=
\{P:X\rightarrow M Y\mid
P\text{ preserves }K,\;
\phi_I\Rightarrow[ P ]\phi_J,\;
\operatorname{effects}(P)\preceq e\}.
$$

The bracket denotes partial correctness over all executions, including the shared failure and prefix obligations fixed by $K$. Success satisfies $\phi_J$; failure must satisfy the failure discipline of $K$. Public arrow boundaries in this fragment are balanced: children and pending operations created by the arrow are terminal and their outcomes observed before local success; child ownership handles cannot escape through these interfaces. Raw computations may still spawn and return, but require a scoped `call` wrapper to meet this boundary discipline. This prevents a later implicit join from introducing a failure omitted by sequential contract composition. Original inputs needed by a later postcondition are retained in typed ports, for example `Pair<OriginalInput, Result>`, or in immutable ghost variables used only by the specification.

For $P\in\mathsf S_K(I,J;e)$ and $Q\in\mathsf S_K(J,H;d)$, define:

$$
(Q\star P)(x)=P(x)\mathbin{\gg=} Q.
$$

Matching interfaces and the shared $K$ obligations give closure:

$$
Q\star P\in\mathsf S_K(I,H;e\otimes d).
$$

The identity is $\operatorname{id}_I(x)=\operatorname{pure}(x)$. Equality ignores metadata IDs, task labels, and proof witnesses when the underlying programs are equivalent in the sense above; metadata used by the program is not erased from its behavior. Associativity and identity descend from $M$. Taking the union over effect bounds gives a category of constrained computations; the bounds provide its graded refinement. Additional exported contract claims are checked by the rules below. This is not a claim that arbitrary contract tuples form an ordinary monad. Indexed presentations are possible refinements. [Orchard, Wadler, and Eades, *Unifying Graded and Parameterised Monads*](https://arxiv.org/abs/2001.10274)

### Composing detailed contracts

For a sequential composite, assume:

$$
Ok_P(x,w,a,w_1,\tau_1)\Rightarrow Pre_Q(a,w_1).
$$

Its successful postcondition is relational composition:

$$
Ok_{Q\star P}(x,w,b,w_2,\tau)=
\exists a,w_1,\tau_1,\tau_2.\;
\tau=\tau_1\cdot\tau_2
\land Ok_P(x,w,a,w_1,\tau_1)
\land Ok_Q(a,w_1,b,w_2,\tau_2).
$$

Its failures are the union of a failure in $P$ and a successful $P$ followed by a failure in $Q$, retaining the intermediate witness and concatenated trace. Its prefix invariant checks prefixes within $P$, and prefixes within $Q$ after a successful $P$. Both stages must preserve the common invariant of $K$. Environmental interference must preserve the boundary implication; it is not assumed away in shared-state executions.

The sequential preservation proof splits executions at the first computation's return. Failure or divergence before that point is governed by $P$'s contract. Otherwise $P$'s postcondition establishes $Q$'s precondition; $Q$'s guarantee supplies the composite postcondition. This proof assumes sound primitive specifications and effect bounds. It is not inferred from empirical admission.

A composite definition records `Pcomp = Q ⋆ P`, the derived contract, combined effects, exact dependencies, and a new task specification describing the composition. It may export a weaker contract only with an implication witness. Each existing explicit execution scope is preserved. Creating separate agent scopes uses:

```text
call(did, x) = spawn(did, x, allocation) >>= (result =>
  match result:
    Err(f) → fail(f)
    Ok(h) → await(h) >>= (outcome =>
      match outcome:
        Ok(a) → pure(a)
        other → fail(asFailure(other))))
```

The run table's `Success(a)` is delivered by `await` as `Ok(a)`. `asFailure` preserves the distinction between failure, cancellation, and indeterminate effects. The scope's allocation, spawning, and joining costs belong to this call's effect bound. Composition of `call` wrappers differs intentionally from inlining their programs; monad laws do not erase explicit boundaries.

## 5. Effect bounds

For this fragment use:

$$
e=(Caps,Reads,Writes,b),
$$

where `Caps` is a required capability set, `Reads` and `Writes` are footprints in the relevant abstract world (including runtime state when observed), and $b\in\mathbb R_{\ge0}\cup\{\infty\}$ is an upper spending bound. The order is componentwise inclusion and numeric comparison. Sequential composition is:

$$
e\otimes d=(Caps_e\cup Caps_d,Reads_e\cup Reads_d,
Writes_e\cup Writes_d,b_e+b_d).
$$

The identity is $(\varnothing,\varnothing,\varnothing,0)$. These operations are associative and monotone. Each primitive has a specified bound; `bind` uses a common bound for all response-dependent continuations. Widening to a larger bound is permitted. Every admission for actual execution requires a finite operational allocation even if static analysis produces $\infty$.

Capabilities describe requirements, not grants. Child authority is bounded by delegated authority. Unbounded retries are not in the composition fragment. Parallel composition is admitted only for explicitly separable read/write footprints and compatible capabilities, with summed spending bounds and contract obligations covering every permitted interleaving.

## 6. Public abstractions and the restricted composition language

An abstraction is an immutable record:

$$
a=\langle aid,did,I,J,C,e,ports,scope,assurance,evidenceRefs\rangle.
$$

`ports` expose typed data and named semantic facts. `scope` states the task/environment conditions for admission. `assurance` is either `proved(certificate)` or `empirical(policy, report)`. Admission status is maintained separately as `active`, `suspended`, or `retired`; the immutable record is never rewritten.

A catalogue $\mathcal C_\ell$ is a collection of abstraction records. A single abstraction is always written $a$, avoiding confusion between a record and a collection.

A composition graph is a typed expression over exact abstraction references:

```text
G ::= id(I)
    | call(aid)
    | wire(structuralMap)
    | seq(G, G)
    | route(test, G, G)
    | guard(test, G)
    | par(G, G, separationWitness)
    | retry(k, G, retryWitness)
```

`structuralMap` is limited to typed projections, pairing, permutation, and copying of immutable values. Linear resources and capabilities cannot be copied. It cannot execute arbitrary code.

`test` is a finite, total Boolean expression made from `true`, `false`, negation, conjunction, disjunction, tagged-union tests, and equality/comparison on declared finite tags or bounded scalar metadata ports. It cannot inspect opaque payloads, enumerate their contents, invoke tools/models, recurse, or contain host-language callbacks.

A domain-specific predicate must be implemented by a separately defined shard and exposed as a typed result with its own contract and evidence. The harness may route on that result. This makes the semantic boundary enforceable by syntax: domain interpretation cannot be hidden inside a routing callback.

For empirical semantic classifiers, applicability checking, estimation and action selection are distinct versioned capabilities. Unsupported input scope or missing evidence yields a declared `Unknown` before inference. The estimator's dependencies include its model, input projection, question schema and any calibration artifact; probability calibration is scoped empirical evidence, not a proof that a branch precondition holds. The action policy selects only independently eligible capabilities under the current allocation, with a compatible fallback or explicit failure. Selection does not grant authority: the runtime rechecks admission and allocation at dispatch. These capabilities use the existing `call`, `seq` and finite `route` grammar. The [semantic decision contract](docs/tasks/semantic-decision-contract.md) specifies their planned records, calibration provenance and acceptance cases without extending the calculus.

Abstraction publication is a registry operation with contract/evidence obligations, not an unchecked `abstract(interface, expression)` expression.

### Typing and interpretation

Write $\mathcal C;K\vdash G:I\Rightarrow J!e$ for a graph with an admitted derivation.

| Constructor | Required rule and interpretation |
|---|---|
| `id(I)` | $I\Rightarrow I$; interprets as `pure`. |
| `call(aid)` | Uses the exact record's interfaces, contract, admission scope, and call-wrapper effect bound; interprets as its explicit scoped invocation. |
| `wire(f)` | `f` belongs to the structural grammar and preserves the stated port predicates; interprets as pure structural mapping. |
| `seq(F,G)` | The first output establishes the second input, including detailed contract obligations; interprets as $\lbrack\!\lbrack F\rbrack\!\rbrack(x)\mathbin{\gg=}\lbrack\!\lbrack G\rbrack\!\rbrack$. |
| `route(t,F,G)` | Both branches have the same exported output; the true/false refinements of the input imply the respective preconditions; interprets as evaluating the total test then executing the selected branch. Bound each effect component by a common upper bound of the branches. |
| `guard(t,F)` | On true execute `F`; on false return the declared `GuardRejected` failure. The enclosing contract must admit that failure. |
| `par(F,G,w)` | A structural input split, separation witness, compatible invariants, and combined-output proof are required. Spawn both scoped branches and join both; propagate unhandled failures. Include wrapper costs. |
| `retry(k,F,w)` | $k\ge1$ is a finite maximum attempt count. The witness establishes restoration of the next attempt's precondition after each retryable failure and bounds repeated effects. Stop on success, nonretryable failure, or the last attempt. |

Proof certificates may discharge semantic implications. An empirical admission may discharge only policy-approved empirical obligations; its derivation is labelled empirical. A decidable syntax/type checker is not assumed to decide arbitrary semantic implication. Structural preservation under a sound derivation is a theorem obligation; empirical reliability remains scoped evidence.

The graph interpretation is $\lbrack\!\lbrack G\rbrack\!\rbrack:X\rightarrow M A$. Wrappers, parallel joins, and bounded retries introduce only explicit operations. There is no implicit latest-version lookup in graph leaves.

Before a graph is admitted, subgraphs requiring a new scope are packaged as exact private definitions and included in its manifest. `retry` runs each attempt in such a scope and examines its `await` outcome before deciding whether to retry or propagate failure. It does not attempt to catch an empty-response `fail` operation inside the same run. `par` similarly retains both child outcomes until both scopes are accounted for. These rules give the interpreter implementations for the control operators without extending the free-monad signature with implicit handlers.

## 7. Versioned history and consistency

A persistent shard history is an audit union, not automatically a learning sample:

$$
H_{sid}=\bigcup_v H_{sid,v}.
$$

Every evidence event records `eid`, `rid`, `did`, exact dependency manifest, candidate/contract hash, input class, environment profile, model and handler versions, evaluator version, outcomes, and provenance. Causally linked events are linked by IDs rather than counted as independent observations.

The default learning cohort is:

$$
B=(sid,v,manifest,taskScope,environment,model,handler,evaluator).
$$

`Extract` produces a candidate from discovery data in a specified cohort. The candidate freezes its public interface, proposed contract, feature map, verifier, and scope before validation. A consistency record identifies the exact validation windows used. Several candidates cannot silently reuse one validation set as if each were an independent experiment.

### A concrete consistency predicate

A policy $\theta$ fixes before validation:

- Required task strata and at least two disjoint validation windows per stratum.
- Minimum sample count $N$ and a fixed actual sample count per window, chosen before observing validation outcomes.
- A bounded feature vector $z\in[0,1]^d$, its distance metric, and stability tolerance $\epsilon$.
- A deterministic verifier producing a binary success observation and declared contradiction classes.
- Minimum acceptable verifier success rate $\rho$.
- Per-test error allowances $\delta_{c,j,k}$, allocated across candidates, strata, and windows so their sum stays within a declared overall allowance.

Define `Consistentθ(candidate, B)` to require all of:

1. Provenance matches the frozen candidate and cohort, or an explicit transfer certificate is present.
2. Each required validation window has at least $N$ eligible, nonduplicated observations.
3. Window feature means differ by at most $\epsilon$ under the declared metric within each stratum.
4. Each window meets the declared success criterion.
5. No unresolved contradiction disqualifies the candidate under the policy.

For independent, identically distributed Bernoulli observations within each declared stratum/window distribution under that fixed sampling scheme, one available success criterion is:

$$
\widehat p_{c,j,k}-\sqrt{\frac{\log(1/\delta_{c,j,k})}{2n_{c,j,k}}}\ge\rho.
$$

This is a lower confidence bound on the specified verifier's success probability under those sampling assumptions. It is not a proof of the semantic contract or of future performance under distribution shift. Without the sampling assumptions, the same window statistics are descriptive and must not be labelled with that confidence guarantee. Verifier validity is a separate assumption.

`Consistent` is now an executable policy predicate once its declared feature/verifier adapters and data are supplied. Selecting useful features and discovering candidates remain research problems.

### Evidence transfer and withdrawal

Changing a definition, model, environment, evaluator, contract, or dependency manifest starts a new cohort. Old evidence remains available for discovery. It does not count toward the new candidate's validation by default.

A transfer certificate records source/target cohorts, the exact claims transported, a justification, permitted transformations, and any uncertainty adjustment. A proof that two versions agree on the relevant observations may justify transfer of those observations; a model change with no such support does not. Transferred observations retain original IDs and cannot be counted again as fresh independent trials.

A contrary observation creates a durable contradiction event. A counterexample to a claimed universal property suspends that claim pending resolution. A statistical failure is assessed under the empirical policy; it is not automatically a universal counterexample. The runtime propagates suspension through recorded dependencies as specified in Section 10.

Weakening a contract, narrowing its scope, or changing its verifier creates a new abstraction version. No process edits an old abstraction's claims to make its old evidence appear successful.

## 8. Harnesses and composition of composition

A harness is a semantic shard definition $D_H$ with a composition-oriented task and program:

$$
P_H:CompositionRequest\rightarrow M\,PatchOutcome.
$$

Its inputs contain typed catalogue interfaces, admitted abstract observations, a target graph version, and requested composition goals. Its output is a relation patch or a declared failure. Its contract constrains the patch's target, syntax, required obligations, and stated effects. A planner can propose a candidate patch; a separate validation step is required before a checked-patch contract may be claimed.

Distinguish two objects:

- $W_H$: the workflow graph managed by the harness, such as a document-conversion pipeline.
- $S_H$: the strategy implementing the harness's own composition work, such as selecting abstractions, constructing a relation patch, and checking it.

For a compositional harness, $P_H=\lbrack\!\lbrack S_H\rbrack\!\rbrack$. Bootstrap primitive strategies are permitted as versioned leaf definitions. A harness can propose mutations to a target it is authorized to govern; it cannot replace arbitrary lower-level implementations through a relation patch.

There are two independent abstraction paths:

$$
\operatorname{Expose}(D_{W_H},evidence_W)=a_W,
$$

$$
\operatorname{Expose}(D_H,evidence_H)=a_H.
$$

The first exposes execution of the managed workflow. The second exposes the harness's own composition capability. Their task types, contracts, traces, and evidence cohorts differ. Success of $W_H$ alone does not validate the composition strategy $S_H$.

A higher governor composes harness capabilities:

$$
S_{parent}\in\operatorname{Comp}(\mathcal C_{composition}),
\qquad a_H\in\mathcal C_{composition}.
$$

When $D_H$ becomes consistent as a composer, it emits $a_H$ and a relation patch to `governor(H)`. The parent can compose, route among, or sequence this capability with other composers. That parent is itself a shard whose strategy may later be abstracted and emitted upward. This is the explicit recursion for composition of composition.

The grammar of composition remains unchanged across levels. At a higher level, typed payloads include graph references, patches, and checked-patch receipts. Graph interpretation and patch construction are capabilities with contracts; routing syntax still has no arbitrary callbacks. Checked receipts are unforgeable runtime values bound to a candidate hash, target version, policy version, and dependency/status fingerprint.

The finite installed governance hierarchy has a root. Its initial strategy and enforcement rules are supplied by the owner/runtime. Recursion does not require an actual infinite chain or authorize a root to redefine the evidence for its own acceptance.

### Persistent composition state

Define a workspace's logical composition state at revision $r$ as:

$$
\mathcal S^{comp}_r=
\langle workspaceId,r,cursor,heads,interfaces,relations,pendingRefs\rangle.
$$

| Component | Persistent meaning |
|---|---|
| `heads` | Exact current graph references for governed workflows and composition strategies |
| `interfaces` | Indexed references to exposed semantic capabilities and their contracts |
| `relations` | Versioned composition patterns and compatibility observations, with scope and evidence references |
| `pendingRefs` | References to unresolved composition problems and proposals, retaining their base versions |
| `cursor` | The committed event watermark represented by this state |

This is a shared semantic layer over the existing definition, abstraction, graph, evidence, and proposal registries. It is not another independently writable source of truth. Committed registry events deterministically update its projection; accepted graph revisions and their composition-state update become visible atomically. Suspension changes the corresponding state and invalidates dependent views under Section 10.

A relation record names exact participants, a relation kind, task/environment scope, bounded outcome statistics, supporting evidence, and assurance/status references. A measured failure in one setting is a scoped observation, not a universal incompatibility theorem. Counters summarize eligible observations within one cohort and retain the references needed to audit them; they do not pool model versions into a false confidence claim.

Physically, records are normalized and referenced by immutable IDs/hashes. A small root checkpoint points to indexed records. Transcripts, full traces, code, and evaluation samples remain in separately retained artifacts. Its fingerprint identifies the checkpoint; the fingerprint alone cannot reconstruct the state.

The persistence obligation is:

$$
\operatorname{Restore}(\operatorname{Persist}(\mathcal S^{comp}_r))
\equiv\mathcal S^{comp}_r,
$$

provided the referenced records/artifacts are available and schemas are compatible. Equivalence preserves exact graph/interface references, relation scopes, assurance provenance, and pending base versions. Current admission and configuration are rechecked after recovery; restoring a checkpoint does not reactivate a suspended claim.

The model-facing operation returns:

$$
\operatorname{View}(\mathcal S^{comp}_r,task,readScope,budget)
\rightarrow\langle records,refs,cursor,omitted\rangle.
$$

Selection and paging bound the representation sent to a model. Omission is explicit, with follow-up query references. Runtime validation resolves the complete required dependency closure from storage; a small view cannot omit an obligation and thereby make a patch admissible. Required information that cannot fit a request is fetched in another bounded query or the operation stops with a declared limit outcome.

Session identity and planner-model identity do not own this composition state. A fresh session or different planner model can read the same interfaces and accepted relations without inheriting old conversations. Executing a capability still uses its pinned implementation and admission scope. Changing an executor model or environment may require a new definition/runtime binding, cohort, and validation; persistence does not make empirical reliability model-independent.

Keep three kinds of state separate: this shared composition state, exact per-run execution checkpoints, and optional shard-local semantic/conversational memory. The continuous shard may consult and propose changes to the shared layer, but is not required for its persistence. Compactness comes from typed records, sharing, bounded summaries, and selective retrieval; storing arbitrarily many distinct relations cannot require constant total space.

## 9. Child-originated relation mutation

A consistent shard originates:

$$
\Delta=\langle originSid,governorSid,baseGid,
newAbstractions,relationEdits,evidenceRefs,obligationRefs\rangle.
$$

The allowed edit language adds or removes nodes, changes exact abstraction references, and rewires typed relations through the grammar in Section 6. It cannot modify definition bodies, abstraction claims, validators, primitive handlers, or the admission policy. A new implementation is registered as a new definition and exposed separately; a relation patch can then select it.

For a graph exporting contract $C_p$ and bound $e_p$, define `ValidΔ` as the conjunction of:

1. `originSid` has the declared governor relationship or an explicit delegated publication capability.
2. `baseGid` is the target head at validation time.
3. New abstractions pass structural admission and the declared consistency/assurance policy.
4. Every referenced exact abstraction is active, or is a newly admitted record staged in this transaction, and the target task is inside its admission scope.
5. Applying the edit yields a well-typed graph under Section 6, with no unresolved obligations.
6. The derived graph contract refines the existing exported $C_p$, at its declared assurance level, and its effects remain within $e_p$ and the granted allocation.
7. The complete dependency manifest and reverse-dependency edges are recorded.

Validation produces a checked receipt. Commit atomically rechecks target version, authority, policy version, dependency statuses, and receipt fingerprint, then installs the staged abstraction records, new immutable graph, and reverse dependencies and advances the head. Staged records are not publicly active before that transaction commits. If any check changed, commit fails with `Stale` or `Invalidated`; rebasing requires new validation. Proposals are not lost merely because another child committed first; they remain explicit rejected/stale records eligible for reprocessing.

Graph revisions preserving the same export contract may proceed automatically. Changing the exported contract creates a new public abstraction version and follows the compatibility rules below.

The receipt attests to admission under a policy. It is not a mathematical proof when its dependencies include empirical claims. If every semantic premise is sound, sequential/graph preservation supplies the corresponding soundness result. Admissibility alone does not prove an improvement in success rate or cost.

## 10. Compatibility, pinning, and invalidation

Graphs refer to exact abstraction versions. Starting a run freezes the complete transitive manifest of permitted definition and abstraction references; dynamic selection is limited to that frozen catalogue. There is no implicit substitution by a newer head. Any expansion or migration requires a new admitted run in v0.3.

For the same interface and context, a replacement contract $C_{new}$ refines $C_{old}$ when:

- $Pre_{old}\Rightarrow Pre_{new}$: the replacement accepts every previously admitted input.
- On old-admissible inputs, `Oknew ⇒ Okold` and `Errnew ⇒ Errold`.
- The new prefix guarantees imply the old ones, under no stronger environment assumptions.
- Every old liveness guarantee remains supported under no stronger scheduler assumptions.
- $e_{new}\preceq e_{old}$, and admission scope and assurance satisfy the dependent graph's requirements.

A replacement may strengthen its success guarantee; it cannot silently strengthen its precondition. Refinement certificates and empirical evidence have distinct labels. Even a compatible replacement changes a graph reference through an explicit revision with a new manifest and validation record.

Maintain reverse dependencies from abstractions and evidence certificates to graphs, higher abstractions, and runs. A contradiction or expired/revoked certificate triggers:

1. Suspend the affected admission claim; preserve its immutable record and history.
2. Mark every transitively dependent admission suspended pending revalidation, including abstraction evidence that relied on the claim.
3. Reject new starts and calls requiring suspended claims.
4. Mark affected active runs cancelling under the runtime-abort rule. Recheck admission before every new external effect and at closure; do not publish a newly successful result under a suspended contract.
5. Account for already dispatched effects and indeterminate outcomes. Suspension does not undo completed external actions.
6. Permit recovery only through explicit revalidation, a supported fallback revision, or a new narrowed/weakened abstraction with dependent contracts checked again.

Conservative transitive suspension avoids treating a pinned version as permanently trustworthy. Pinning freezes meaning; live admission checks determine whether execution may continue under that meaning. Replacement versions never rewrite the evidence or outcomes of old runs.

## 11. Worked mutation: a domain shard changes its harness

Consider deterministic normalization of a finite record batch. Let `Decoded` mean a batch of well-typed records, `Canonical` mean the required normal form, and `Complete` mean that every input record appears exactly once in the result. Outputs retain the input batch identifier and an immutable audit mapping.

The harness exports:

```text
Input:  Decoded(batch)
Success: Canonical(result) ∧ Complete(batch, result)
Failure: declared validation/runtime failures
```

Its existing graph is `call(slowCanonical@1)`. Two other exact abstractions are available:

```text
classify@3 : Decoded → Pair<Decoded, Tag>
Tag = FastEligible | General
Guarantee: FastEligible implies the fast path's precondition

fastCanonical@4 : FastEligibleBatch → CanonicalCompleteBatch
Guarantee: canonical output with complete record correspondence
```

`classify@3` performs the domain-specific interpretation. The harness only reads its finite output tag.

After version-scoped discovery and validation, `fastCanonical@4` meets its consistency policy and emits a parent relation patch producing:

```text
seq(
  call(classify@3),
  route(
    tag == FastEligible,
    seq(wire(batchProjection), call(fastCanonical@4)),
    seq(wire(batchProjection), call(slowCanonical@1))
  )
)
```

The derivation is:

1. `classify@3` accepts the old graph's input predicate and preserves the decoded batch.
2. In the true branch, the classifier guarantee establishes the fast path's precondition.
3. In the false branch, `Decoded` still establishes the slow path's precondition.
4. Both branches return `Canonical ∧ Complete` with the required audit mapping.
5. Classifier and call-wrapper failures fit the harness's declared failure contract; otherwise this patch must be rejected or the export version changed.
6. Classification cost plus the maximum branch bound, including wrapper costs, fits the existing harness bound.
7. Exact references, evidence, and authority validate; atomic commit installs a new graph version.

Under sound leaf contracts, the sequential and route rules establish preservation of the exported postcondition. If a leaf has only empirical assurance, the composite admission retains that qualification. The consistency report supports publishing the fast capability; the separate derivation supports putting it in this composition. Faster average execution requires an additional comparative measurement.

If `fastCanonical@5` later requires an extra input condition, it does not replace `@4` automatically. The classifier relation must establish that condition in a separately validated graph revision. If a counterexample suspends `@4`, the dependent graph suspends; the old slow graph can be restored only through a supported fallback revision.

## 12. Worked mutation: a harness changes a higher harness

Now consider a harness `RouteComposer@2` whose task is to build the kind of typed conditional composition used above. Its input is an abstract composition problem:

```text
CompositionProblem = {
  baseGraphRef,
  exportedContractRef,
  classifierRef,
  fastCapabilityRef,
  fallbackCapabilityRef,
  requestedEffectBound
}
```

It sees exposed interfaces and obligations. It does not inspect record payloads or implement record normalization. Its output is `CandidatePatch<baseGraphRef>` or a declared planning failure.

Its own strategy is a graph of composer capabilities:

```text
S_route = seq(
  call(matchConditionalInterfaces@1),
  call(buildConditionalRelations@2)
)
```

A higher harness initially uses:

```text
seq(call(genericComposer@1), call(validatePatch@1))
```

The higher harness exports a `CheckedPatch` bound to the requested target version, or an explicit failure. `validatePatch@1` accepts structurally formed candidate patches, checks all required semantic/effect obligations under the policy, and returns a checked receipt or rejection. A checked receipt is usable only while commit-time fingerprint checks remain satisfied.

`RouteComposer@2` accumulates its own cohort across composition problems with different leaf capability identities and domains. Its evidence measures patch validity, applicable scope, failures, and cost. Evidence that the record-normalization workflow succeeded is not counted as an independent successful composer run.

Once consistent, it exposes `routeComposer@2` and originates this patch to its own governor:

```text
seq(
  call(classifyCompositionProblem@1),
  seq(
    route(
      kind == ConditionalCompatible,
      seq(wire(problemProjection), call(routeComposer@2)),
      seq(wire(problemProjection), call(genericComposer@1))
    ),
    call(validatePatch@1)
  )
)
```

The derivation is:

1. The composition classifier's contract establishes `routeComposer@2`'s precondition on the selected branch.
2. Both planners produce candidates for the same requested target version and output type, or admitted failures.
3. The shared validator converts either candidate to the higher harness's required checked-patch output or a permitted rejection.
4. The derived failure contract and effect bound remain within the higher harness's export contract and allocation.
5. The origin is a child composer of this governor; the patch changes only relations among exact composer abstractions.
6. Admission and atomic commit update the higher harness's strategy graph.

The mutated object is the higher harness's own method of composing, not merely a workflow executed by a lower harness. It can subsequently be evaluated as a composer, expose its own abstraction, and originate a relation mutation to its next governor. No new computation type or unrestricted routing callback is introduced at the higher level.

## 13. Continuous shard and durable recurrence

The continuous shard has a persistent `sid` and versioned step definition:

$$
step:(S,Event)\rightarrow M(S\times Actions).
$$

A scheduler starts a scoped step with a frozen manifest, then atomically records the committed state version and an outbox of identified follow-up actions. The next step reads that committed state. Repeated event delivery uses event IDs; external actions use adapter-supported idempotency or explicit indeterminate outcomes. No exactly-once guarantee is inferred for arbitrary external services.

This is durable recurrence of ordinary monadic computations. It supports identity, goals, autobiographical memory, capability estimates, and attention without requiring one non-returning value. A new step definition needs state-schema compatibility and a new evidence cohort; running steps are not silently migrated. Well-founded local syntax does not prove global termination: recurrent scheduling, pending handlers, or recursive registry calls may continue indefinitely, subject to operational allocations and the stated liveness assumptions.

## 14. Established structure and remaining research

| Property | Status |
|---|---|
| Execution monad laws | Structural proof sketch in Section 2 |
| Semantic identity and associative composition | Defined for matching contract-constrained arrows; preservation sketch in Section 4 |
| Ownership and scope closure | Transition rules in Section 3; no detach transition |
| Effect bounds | Concrete ordered algebra and admission rules in Section 5 |
| Abstract-only harness relations | Restricted grammar and typed invocation boundary in Section 6 |
| Consistency | Concrete policy predicate with explicit cohort and sampling assumptions in Section 7 |
| Harness self-abstraction | Separate workflow/composer abstractions and upward mutation in Section 8 |
| Cross-session composition persistence | Shared versioned semantic state, bounded views, and restoration obligation in Section 8 |
| Concurrent mutation | Versioned validation receipts and atomic rechecks in Section 9 |
| Contract changes and counterevidence | Refinement, exact pinning, and transitive suspension in Section 10 |
| Both mutation levels | Worked contract derivations in Sections 11–12 |
| Continuous identity | Durable step protocol in Section 13 |
| Automatic discovery of useful abstractions | Research problem; a candidate generator is not supplied |
| Empirical generalization or indefinite improvement | Not established by the calculus |
| Implementation correctness | Requires implementation, adapter validation, and tests or mechanized proofs |

The model now specifies how executions produce attributable evidence, how consistency permits abstraction admission, how a child-originated relation patch is checked, and under which assumptions composition preserves the parent's contract. The remaining learning question is whether candidate extraction discovers useful abstractions and relations often enough to justify their execution and validation cost.

## References

- Gordon D. Plotkin and Matija Pretnar. [*Handling Algebraic Effects*](https://lmcs.episciences.org/705). Logical Methods in Computer Science, 2013.
- Dominic Orchard, Philip Wadler, and Harley Eades III. [*Unifying Graded and Parameterised Monads*](https://arxiv.org/abs/2001.10274). 2020.

These references ground the computational-effects machinery. The semantic shard, evidence, and recursive relation-mutation system is the proposed model defined here. Its empirical learning claims are not theorems of those references.
