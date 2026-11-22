# A priori checks: proposal and handoff

Status: proposal only; nothing is implemented, frozen or authorized by this document. It hands off work done outside this repository so that a session here can decide whether to pursue it. Any experiment it suggests needs its own task record, frozen manifest, budget and stopping condition under the existing protocols.

Source of the ideas: a formal calculus of abstraction and a prototype agent specification, kept outside this repository:
- `/home/nathias/Documents/notes/philosophy/Abstraction/typeTheory/agents/Agent.lean`: a checker specification with mechanically checked soundness theorems (goal, identity continuation, no forbidden state, no self-granted authority, budget, manner of execution, memory consistency).
- `/home/nathias/Documents/notes/philosophy/Abstraction/typeTheory/agents/README.md`: the mapping of identity, state, relation, modality and process to the calculus, and its limits.
- `/home/nathias/Documents/notes/philosophy/Abstraction/typeTheory/2-Calculus.md`: the rules (two-part adequacy C38, bound analyticity C54–C57).

The prototype's Python loop is not to be imported: the plan forbids embedding another agent loop. Only the specifications and the checks carry over, reimplemented as ordinary versioned capabilities in this codebase's own terms (contracts, invariants, rejections).

## Question

`new.md` lists three kinds of classifier: static, model/empirical, and a priori (epistemological). Can a deterministic a priori check, decided from declared contracts and the request alone, with no inference and no calibration, improve the measured outcome of repair workflows, or expose a tradeoff the previous pilots did not observe?

## Three candidate uses, in order of priority

1. **Manner-sensitive evaluation.** The central-hypothesis pilot stopped with no tradeoff: every direct repair passed public and hidden checks. The evaluator checks the outcome. Real repairs can reach the right outcome in the wrong manner: weakening or deleting a test, special-casing the fixture, editing outside the requested scope, leaving the faulty path in place. Add a declared, deterministic manner verdict next to the outcome verdict ("verified" vs "verified in the requested manner"). Hypothesis to freeze before any observation: on naturally occurring repair tasks, direct repair has a lower manner-verified rate than a workflow with independent verification, enough to repay its cost. This changes what counts as success, so it must be declared in the manifest before outcomes, not added after.
2. **An a priori check capability.** A versioned capability returning pass, rejection with a precise repair signal, or `Unknown`, for proposed patches, actions and relation mutations. Checks: requested manner; authority grounded only in the user or governor, never in the proposer's own output or tool results; compatibility with declared invariants; continuation of the declared identity of a revised shard (accepts the old input scope, preserves required outcomes). It fits the semantic decision contract's applicability stage: it runs before inference and needs no calibration. Its scope is what can be decided within its own check budget; everything else goes to empirical evaluation.
3. **Mechanized proofs for the formal model.** `computational-shard.md` states its proofs are sketches. `Agent.lean` shows the pattern (specify the checker, prove what an accepted plan guarantees). First candidates: ownership acyclicity, composition of effect bounds, stale-receipt rejection, transitive invalidation. A Lean model could also serve as an oracle for the planned pure reference interpreter.

## Limits

- The guarantees of any such check hold for the contracts and effects as declared. Real effects must be observed by instruments (diff scope, changed files, test runs), and the checks are only as good as those instruments.
- Vetoes should be limited to incompatibility with declared invariants, identity breaks and ungrounded authority. Preferences, including manner preferences that are not part of the request, should rank candidates rather than forbid them.
- A Claude-driven trial in the prototype (one toy scenario, with full and with description-only tool views) produced no rejections: the scenario was too easy, as in the central-hypothesis pilot. It is not evidence of benefit.
