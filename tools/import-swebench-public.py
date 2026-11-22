"""Project public columns from a pinned local parquet; never print gold data.

Run with an isolated pyarrow dependency, not the agent runtime.
"""
import hashlib
import json
import pathlib
import sys

import pyarrow.parquet as pq

source, destination = map(pathlib.Path, sys.argv[1:])
rows = pq.read_table(source, columns=[
    "instance_id", "repo", "base_commit", "problem_statement"
]).to_pylist()
envelope = {
    "dataset": {
        "name": "princeton-nlp/SWE-bench_Verified",
        "revision": "c104f840cc67f8b6eec6f759ebc8b2693d585d4a",
        "upstreamSplit": "test",
        "file": "data/test-00000-of-00001.parquet",
    },
    "parquetSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "rows": rows,
}
with destination.open("x") as output:
    json.dump(envelope, output, sort_keys=True)
print(json.dumps({"rows": len(rows), "parquetSha256": envelope["parquetSha256"]}))
