# M3 frozen comparison protocol

The M3 comparison protocol freezes the experiment reference, model/executor/configuration, evaluator/profile fingerprints, one replication per task-and-variant cell, known-usage requirement, token and observed-action ceilings, and a paired default-versus-candidate schedule. Its report has stable protocol and result fingerprints.

The assembler fails closed unless every scheduled cell is present exactly once and matches its task source lineage, split, variant, model, executor, configuration, evaluator, profile, usage rule and ceilings. Failed evaluations remain observations. `m3ComparisonObservationsFromCohort` rebuilds those inputs from the durable cohort-to-evaluation-to-provider chain; it does not accept caller-supplied outcome, usage, command or tool metrics.

Experiment manifest `m3/fixed-coding-comparison@2` replaces the development candidate with `m3/harness-planning-checklist@1`. The candidate adds a versioned, deterministic checklist derived from each task's frozen ref, editable path and source hash; the default contains none. The earlier `m3/harness-planning@1` remains registered solely to interpret historical smoke data and is excluded from the comparison schedule. `strip-suffix@1` is an untouched held-out task. The isolated runner invokes `bun test` across the materialized task workspace, so it does not contain a task-specific test path.

`m3/development-comparison@1` is the first paid cohort: exactly `trim-prefix@1` under default and checklist variants, with `gpt-6-astra`, the read-only Codex profile, the current evaluator fingerprint, known usage, 20,000 input-token and 2,000 output-token ceilings, and zero observed commands or tools. Its deterministic selection rule retains the default unless the checklist verifies where default fails or both verify and the checklist has a lower known total-token count. Only a selected checklist creates `m3/held-out-comparison@1`, which pairs the unchanged `strip-suffix@1` task with default. `m3-development-report <cohort-ref>` assembles this evidence and selection without calling a provider.

The protocol was completed before any new provider call. The development cohort is now closed; further provider calls require a fresh hypothesis and a new frozen scope and budget.

## Development result (2026-09-20)

The named cohort was recorded under `/tmp/g0verm3nt-m3-development`. Both `gpt-6-astra` calls produced the same verified `trimPrefix` patch in the independent Bubblewrap evaluator, with three trusted tests passing and zero observed commands or tools. Default run `m3-refactor/9f417240-64ed-4183-94f6-0cb775b562c6` used 14,091 input, 11,520 cached-input and 150 output tokens (14,241 total). Checklist run `m3-refactor/9abb3f5e-4376-412b-99bb-316e7d18a6bc` used 14,110 input, 11,520 cached-input and 150 output tokens (14,260 total). Both obeyed the frozen ceilings.

The assembled report fingerprint is `aed06bcebe19cef87a5f01134058366390cebb4499775f6abe0b9fc5a7af4d78`; its frozen selection is `baseline-retained`. This is one paired development observation, not a general performance claim. Because the intervention did not win the predeclared rule, `strip-suffix@1` remains untouched and no held-out provider calls were made.
