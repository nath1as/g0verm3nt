# M2-D6: composition relations

Composition relations are now durable authoritative records identified by immutable relation IDs. Each record names a relation kind, exact left and right references, bounded scope metadata, status, and creation time. Lookup is deterministic by the exact participant pair and relation kind ordering.

A trusted normalization commit also derives `normalization-relation/<proposal-id>` inside the same transaction. Its canonical scope contains the proposal, receipt, policy, evidence IDs/fingerprint, origin/governor and dependency-status fingerprint. Suspending a dependency suspends the derived relation with its supported head. Caller-authored relation records remain available for existing non-derived uses.

Checkpoint entries remain references into this registry; the checkpoint does not duplicate relation bodies. Relation scope is bounded to 4 KiB, and restart tests verify the record remains available after reopening SQLite.
