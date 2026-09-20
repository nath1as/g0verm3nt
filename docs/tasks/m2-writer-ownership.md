# M2-A2 — OS-backed workspace writer ownership

Status: complete

Behavior and scope: SqliteRunStore.open(stateDirectory) acquires an exclusive nonblocking Linux flock lock on stateDirectory/runtime.lock before opening SQLite or applying migrations. The lock is held by a child process whose stdin remains open for the store lifetime. Closing the store closes SQLite, ends that pipe, and waits for the lock holder to exit. If the owner process crashes, its pipe closes and the kernel releases the lock.

runtime.lock contains a mode-0600 JSON diagnostic: application owner PID, lock-holder PID, acquisition time, and protocol. Its presence and its PID are never used as evidence of ownership; the held kernel lock is the authority.

Platform binding: this first prototype targets Linux and requires /usr/bin/flock, /bin/sh, and /usr/bin/cat. A platform without that binding fails before SQLite opens.

Acceptance evidence:

- a held store prevents a separate CLI process from acquiring the same state directory;
- the competing process returns a clear writer-lock failure;
- after the owner closes, a successor opens the same directory;
- bun test tests/writer-lock.test.ts passes.

Dependencies and exclusions: this establishes one writable owner only. It does not make inspection read-only, dispatch an outbox row, decode catalogue records into executable adapters, or recover a persisted frame. Startup reconciliation remains disabled until those behaviors have explicit rules and tests.

Open issues / next step: decode a pinned persisted catalogue into runnable checked adapters, then implement restart reconciliation under this ownership boundary without replaying dispatched or indeterminate operations.
