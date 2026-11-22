# Repository benchmark preparation — 2026-09-20

The [evaluation reset](repository-benchmark-plan.md) now has an actual frozen task cohort, not another generated task proposal.

- Downloaded the 500-row SWE-bench Verified test split at upstream revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`.
- Source parquet SHA-256: `a45b1fe4e2f0c8390b2b2938ac83e92ed5979000856808f3679c07812e9e6dcd`.
- Selected 22 unique issues across 12 repositories by the committed outcome-blind selector: two infrastructure smoke, eight development, twelve reserved assessment.
- Cohort fingerprint: `d15a54fbfe492fb6c51adbe35327e950a1652d8902c3a2d3d6291bfb8359d4bf`.
- Local manifest: `.government/swebench-cohort-2026-09-20/cohort.json`. Source parquet and public projection: `.government/swebench-import/`. These are controller artifacts, not worker mounts.

Smoke IDs are `scikit-learn__scikit-learn-10908` at base commit `67d06b18c68ee4452768f8a1e868565dd4354abf` and `sympy__sympy-17318` at `d4e0231b08147337745dcf601e62de7eefe2fb2d`. They were selected without inspecting gold patches or worker outcomes. No issue solution was generated and no assessment task was attempted.

Public projection allowlists four columns and excludes gold patches, test patches, hints and test labels. The cohort contains issue hashes rather than issue bodies. Tests verify privileged-field exclusion, row-order invariance, outcome-independent sampling and disjoint phase IDs. Repository checks passed: 155 tests, one opt-in skip, 815 assertions, typecheck, lint and diff check.

The temporary dependency environment used binary PyArrow 23.0.1. An initial PyArrow 21 source build was cancelled rather than installing system dependencies; it generated no benchmark observations. No project runtime dependencies changed.

`launchReady` remains false. The [official grading bridge](repository-benchmark-smoke.md) is implemented with offline control-validation tests. Docker availability was verified after host recovery; the first digest-pinned image pull timed out after 30 minutes on a slow connection. No grading jobs ran. Live grading and isolated repository-executor qualification remain pending. Dataset preparation does not demonstrate that an image builds or an issue is solvable in this environment. No model calls, cloud jobs, grading containers or new benchmark scores were produced.

Next: finish provisioning the pinned images, then run empty/gold patch checks for the two smoke IDs. Complete executor isolation, tool budgets and trajectory accounting before spending on the eight-task workflow comparison.
