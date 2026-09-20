# M2-D5: composition checkpoint

The composition checkpoint is a compact projection over durable graph records. It stores a named root reference, an optional cursor, and an ordered bounded list of exact record references. The checkpoint does not duplicate graph definitions, proposals, or dependency records.

The canonical root descriptor, including its root reference, cursor, and ordered references, is limited to 4 KiB. The returned view is limited to 32 references and 16 KiB of serialized metadata. Writes are upserts by checkpoint identity; reads validate the stored reference list before returning it. A restart restores the same checkpoint and cursor while authoritative records remain queryable from their existing tables.

Deterministic views report omitted records and a continuation cursor explicitly. The next refinement is an authoritative relation record/query layer behind these references.

The authoritative shared-composition view uses the same 16 KiB UTF-8 cap. It orders summary references by code point, returns the largest requested prefix that fits, and reports the remainder with an advancing offset cursor. A single summary that cannot fit fails closed; callers fetch its authoritative record through a separate bounded query rather than receiving an oversized view.
