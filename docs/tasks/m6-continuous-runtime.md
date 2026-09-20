# M6 conditional scaffold: continuous runtime

The durable SQLite writer and reconciliation boundaries provide the persistence core for a future continuous shard or socket runtime. A later implementation must preserve single-writer ownership, explicit dispatched versus indeterminate operations, cancellation, and restart reconciliation. Transport, scheduling, and deployment remain intentionally unimplemented.
