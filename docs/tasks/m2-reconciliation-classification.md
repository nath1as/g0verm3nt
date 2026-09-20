# M2-B1 — Explicit operation reconciliation

Status: complete

Behavior and scope: reconcileGraphExecution validates the pinned execution, frame, operation, and outbox under the workspace writer lock. It never dispatches. Planned work is returned as dispatchable for a future explicit dispatcher. A dispatched operation is atomically moved to indeterminate because its external outcome is unknown. An existing indeterminate operation stays indeterminate.

The method neither advances a running frame nor applies an observation. It does not infer success, zero usage, or a failed external request from a restart.

Acceptance evidence:

- planned work remains pending and is reported dispatchable;
- dispatched work transitions to indeterminate and leaves the pending outbox;
- repeated reconciliation preserves indeterminate state;
- bun test tests/storage-graph-execution.test.ts passes.

Open issues / next step: introduce an adapter reconciliation contract that can attribute a later external outcome. Automatic replay remains prohibited.
