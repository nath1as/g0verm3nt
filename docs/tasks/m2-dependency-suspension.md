# M2-D4: dependency status and suspension

The proposal layer now records dependency state separately from proposal lifecycle. Each direct dependency reference has one durable status row with a status, optional reason, content fingerprint, and change time. Proposal creation materializes an active status for new references without overwriting an existing status.

Status transitions are transactional and idempotent. Moving a reference to suspended or retired marks pending proposals that directly depend on it as suspended. Committed proposals are left intact because their head commit has already passed the proposal gate.

A proposal receipt stores the dependency status fingerprint observed during checking. Commit recomputes the current fingerprint and rejects the receipt if any direct dependency changed, or if the proposal is already suspended. This closes the check-to-commit race while keeping transitive dependency closure outside this slice.

The storage test covers shared dependency reverse lookup, suspension of the competing proposal, failed commit after revocation, and restoration of both proposal and dependency status after SQLite restart.
