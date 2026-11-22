# Official grading bridge — 2026-09-20

`tools/swebench_smoke.py` prepares and runs the two frozen smoke tasks only. It
cannot launch development or assessment model jobs. No benchmark score exists yet.

Offline verification completed: the project-local Python 3.12.14 environment has
all 76 locked dependencies; `--check-evaluator` imported the official evaluator and
constructed both frozen test specifications. Its evidence manifest is
`.government/swebench-smoke-preparation-2026-09-20-qualified-import/manifest.json`.
Five Python boundary tests pass through the Bun suite, which reports 156 passes,
one opt-in skip, and 817 assertions; typecheck, lint and diff checks also pass.

## Controls and provenance

- Official SWE-bench v4.1.0 source pinned to `726c5461e2ef52d83cf1ea2107870a8bb3328d57`;
  modified checkouts are rejected. Python 3.12 dependencies are version-locked in
  `tools/swebench-requirements.lock` and checked before execution.
- Dataset bytes, cohort fingerprint, task identity, base commits and problem hashes
  are checked. Four sequential jobs; an outer 30-minute deadline per job; stop on
  the first failed control without replacement tasks or implicit retries.
- Fresh containers and private logs per job. Output directories cannot be reused.
  Started records precede dispatch. Immutable local image IDs, registry digests
  when available, environment versions and report hashes are retained.
- No image pulls/builds. Execution requires two local Linux/amd64 images, at most
  50 GiB summed size, each with a clean repository at its frozen base commit.
- Containers have no host mounts or network, drop capabilities, and have limits
  of 8 GiB RAM, two CPUs and 512 processes. Cleanup targets only the current job.
  The bridge now checks Docker inspect data before applying patches and records the
  observed container policy. These restrictions still require live qualification.

The upstream CLI filters empty predictions. The bridge calls official `run_instance`
directly and accepts the empty base patch using `/bin/true`, changing no source and
avoiding newer Git flags unavailable in historical benchmark images.
Gold uses normal upstream patch commands. Official test scripts, parsers and grading
remain unchanged. Container creation is adapted to enforce the recorded policy.

Base qualification requires an observed target failure, passing regression tests,
and official unresolved status. Gold must resolve the issue with all required tests
observed. Missing reports, skipped/unobserved tests, application failures and timeouts
cannot count as measured base failures. This stricter smoke gate does not modify
the official score or justify substituting easier tasks.

## Reproduction

Clone the v4.1.0 tag into `.government/vendor/SWE-bench` if absent. Create a Python
3.12 virtual environment at `.government/swebench-venv` and install the lock:

```sh
UV_CACHE_DIR=/tmp/government-uv-cache uv pip sync --python .government/swebench-venv/bin/python tools/swebench-requirements.lock --only-binary :all:
.government/swebench-venv/bin/python -B tools/swebench_smoke.py \
  --cohort .government/swebench-cohort-2026-09-20/cohort.json \
  --parquet .government/swebench-import/verified.parquet \
  --vendor .government/vendor/SWE-bench \
  --output .government/swebench-smoke-preparation-new
```

Preparation needs PyArrow but neither Docker nor models. Its manifest names the
two upstream image references. Add `--check-evaluator` to verify the locked Python
environment and construct both official test specifications without Docker.
The preparation manifest records whether that stronger check was performed.
After Docker works, provision these images within
the planned download/disk budget, verify registry provenance, and freeze a private
JSON map `{ "<instance ID>": "sha256:<local image ID>" }`. Local image-size checking
does **not** enforce download allowance; image provisioning is a separate pending
operation. Execute the same command with a fresh output directory plus
`--images <image-map.json> --execute`.

Raw logs, patches, and controller artifacts must never reach workers. Even successful
smoke qualification records `launchReady: false` until repository executor isolation,
budget enforcement and trajectory accounting pass their own qualification.

## Docker recovery and remaining gates

Docker availability was verified on 2026-09-20 after the user restarted the host.
The daemon reports version 29.8.0 and kernel `7.2.6-arch2-1`, with 16 CPUs,
about 30.6 GiB RAM and 1.18 TiB free filesystem capacity. The earlier kernel/module
mismatch is no longer the blocker.

Registry manifests for the two frozen images are recorded in
`.government/swebench-image-provision-2026-09-20/registry.json`. Their combined
compressed layer size is 2,552,939,404 bytes (2.38 GiB). Provisioning pulls by
immutable manifest digest, enforces a 30-minute deadline per image and checks
local platform, identity, provenance and combined compressed/unpacked size before
creating the private image map. No image is built and no model is called.
The first image pull timed out after 1,800 seconds. Only small layers and the
29.7 MB base layer completed; neither image was fully provisioned and the second
pull never started. A bounded direct registry sample returned 1 MiB in 11.09
seconds, confirming that slow transfer also affected a non-Docker client.
`failure.json`, the pull log and `transfer-sample.json` in the provisioning
directory retain this evidence. An additional interactive request briefly
observed Docker's shared layer progress and was cancelled before the original
pull timed out. Diagnostic samples downloaded another 1 MiB plus 1 KiB.

No grading containers or model calls ran. The four control jobs remain
unattempted; this is an infrastructure outcome, not a benchmark failure or score.
Resume by provisioning the same digest-pinned images on a faster connection or
with an explicitly revised provisioning time window, then freeze the local image
map and execute the four controls. Preserve this attempt's artifacts in place;
use a new output directory for subsequent attempts.

After the live-policy assertion was added, `bun run check` passed: 156 tests,
one opt-in skip, 817 assertions, typecheck and lint. The five Python boundary tests
also passed. Live policy enforcement remains unqualified until containers run.

Remaining order: qualify four controls; implement and qualify a worker filesystem
containing only base source and allowed dependencies (upstream images can retain
solution history); integrate bounded actions and durable trajectory accounting;
then run the matched development comparison. The old tool-free gateway is unchanged.
