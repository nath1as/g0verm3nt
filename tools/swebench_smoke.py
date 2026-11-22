"""Controller-only SWE-bench qualification. Never mount these inputs in a worker.

Preparation is offline; execution requires already provisioned, pinned local images.
The official parser and grading rules remain unchanged. Only container creation
and empty-patch application are adapted, explicitly recorded in the manifest.
"""

import argparse
import hashlib
from importlib.metadata import distributions
import json
import multiprocessing
import os
from pathlib import Path
import re
import subprocess
import sys
import time

EVALUATOR_COMMIT = "726c5461e2ef52d83cf1ea2107870a8bb3328d57"
COHORT_HASH = "d15a54fbfe492fb6c51adbe35327e950a1652d8902c3a2d3d6291bfb8359d4bf"
PARQUET_HASH = "a45b1fe4e2f0c8390b2b2938ac83e92ed5979000856808f3679c07812e9e6dcd"
TIMEOUT = 1800


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def save(path, value):
    # Refuse overwrite/replay, including a previous partial or failed run.
    with path.open("x") as out:
        out.write(canonical(value) + "\n")


def check_environment(vendor, rows):
    if sys.version_info[:2] != (3, 12) or sys.platform != "linux":
        raise ValueError("execution requires the pinned Linux Python 3.12 environment")
    installed = {re.sub(r"[-_.]+", "-", dist.metadata["Name"]).lower(): dist.version
                 for dist in distributions()}
    for line in Path(__file__).with_name("swebench-requirements.lock").read_text().splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        name, version = line.split("==")
        if installed.get(name.lower()) != version:
            raise ValueError(f"dependency lock mismatch: {name}")
    sys.path.insert(0, str(vendor))
    from swebench.harness import run_evaluation
    from swebench.harness.test_spec.test_spec import make_test_spec
    if not callable(run_evaluation.run_instance):
        raise ValueError("official evaluator entrypoint unavailable")
    for row in rows:
        spec = make_test_spec(row, namespace="swebench", arch="x86_64")
        if not spec.FAIL_TO_PASS or not spec.eval_script:
            raise ValueError("official smoke specification is incomplete")


def smoke_rows(cohort, rows):
    payload = {key: value for key, value in cohort.items() if key != "fingerprint"}
    if (cohort.get("fingerprint") != COHORT_HASH
            or digest(canonical(payload).encode()) != COHORT_HASH
            or cohort.get("parquetSha256") != PARQUET_HASH):
        raise ValueError("cohort provenance mismatch")
    selected = [task for task in cohort["selected"] if task["phase"] == "smoke"]
    if len(selected) != 2 or len({task["instanceId"] for task in selected}) != 2:
        raise ValueError("exactly two frozen smoke tasks required")
    result = []
    for task in selected:
        matches = [row for row in rows if row["instance_id"] == task["instanceId"]]
        if len(matches) != 1:
            raise ValueError("missing or duplicate smoke row")
        row = matches[0]
        if (row["base_commit"] != task["baseCommit"] or row["repo"] != task["repo"]
                or digest(canonical(row["problem_statement"]).encode()) != task["problemFingerprint"]):
            raise ValueError("smoke row identity mismatch")
        result.append(row)
    return result


def qualify(report, instance_id, control, statuses, fail_to_pass, pass_to_pass):
    """Missing tests or infrastructure failures cannot qualify as base failures."""
    if control not in ("base", "gold"):
        raise ValueError("unknown control")
    if set(report) != {instance_id}:
        raise ValueError("report identity mismatch")
    result = report[instance_id]
    if result.get("patch_successfully_applied") is not True:
        raise ValueError("patch or test execution failed")
    if not fail_to_pass or not all(
        statuses.get(test) in ("PASSED", "FAILED", "ERROR")
        for test in [*fail_to_pass, *pass_to_pass]
    ):
        raise ValueError("required tests were not observed")
    if not all(statuses[test] == "PASSED" for test in pass_to_pass):
        raise ValueError("base regression tests failed")
    expected = control == "gold"
    if result.get("resolved") is not expected:
        raise ValueError("unexpected official resolution")
    if expected and not all(statuses[test] == "PASSED" for test in fail_to_pass):
        raise ValueError("gold did not repair every target test")
    if not expected and not any(statuses[test] in ("FAILED", "ERROR") for test in fail_to_pass):
        raise ValueError("base control has no observed target failure")
    return {"qualified": True, "resolved": expected,
            "observedTargetTests": len(fail_to_pass), "observedRegressionTests": len(pass_to_pass)}


def evaluate(row, control, image_id, run_id, output):
    # Executed in a separate process. Parent bounds the whole job, not just tests.
    started = time.monotonic()
    import docker
    from swebench.harness import run_evaluation as official
    from swebench.harness.grading import get_logs_eval
    from swebench.harness.test_spec.test_spec import make_test_spec

    os.chdir(output)
    client = docker.from_env(timeout=60)
    spec = make_test_spec(row, namespace="swebench", arch="x86_64")

    def create_container(test_spec, client, run_id, logger, *args):
        # Immutable local ID: no implicit pull, host mounts, credentials or socket.
        container = client.containers.create(
            image=image_id, name=test_spec.get_instance_container_name(run_id),
            command=["/bin/sh", "-c", "tail -f /dev/null"], detach=True,
            network_disabled=True, cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"], pids_limit=512,
            mem_limit="8g", nano_cpus=2_000_000_000, platform="linux/amd64",
        )
        try:
            container.start()
            container.reload()
            host = container.attrs["HostConfig"]
            if (container.attrs.get("Mounts") or not container.attrs["Config"].get("NetworkDisabled")
                    or host.get("Privileged") or host.get("CapAdd")
                    or "ALL" not in host.get("CapDrop", [])
                    or "no-new-privileges:true" not in host.get("SecurityOpt", [])
                    or host.get("Memory") != 8 * 1024**3
                    or host.get("NanoCpus") != 2_000_000_000
                    or host.get("PidsLimit") != 512):
                raise ValueError("live container isolation policy mismatch")
            save(Path(f"{row['instance_id']}-{control}.container.json"), {
                "containerId": container.id, "imageId": container.attrs["Image"],
                "mounts": container.attrs["Mounts"], "hostConfig": host,
                "networkDisabled": container.attrs["Config"]["NetworkDisabled"],
            })
            head = container.exec_run(["git", "rev-parse", "HEAD"], workdir="/testbed")
            status = container.exec_run(["git", "status", "--porcelain"], workdir="/testbed")
            if (head.exit_code or head.output.decode().strip() != row["base_commit"]
                    or status.exit_code or status.output.strip()):
                raise ValueError("image repository must be clean at the frozen base commit")
            container.stop(timeout=5)
            return container
        except BaseException:
            container.remove(force=True)
            raise

    official.build_container = create_container
    patch = row["patch"] if control == "gold" else ""
    if control == "base":
        # Direct run_instance bypasses the CLI's empty-prediction filtering.
        # Accept the zero-byte patch as a no-op without requiring a newer git
        # --allow-empty flag inside historical benchmark images. Tests still run.
        official.GIT_APPLY_CMDS = ["/bin/true"]
    prediction = {"instance_id": row["instance_id"], "model_name_or_path": control,
                  "model_patch": patch}
    result = official.run_instance(spec, prediction, False, False, client, run_id, TIMEOUT)
    if result.get("completed") is not True:
        raise RuntimeError("official evaluation did not complete; inspect private logs")
    log_dir = Path("logs/run_evaluation") / run_id / control / row["instance_id"]
    statuses, found = get_logs_eval(spec, log_dir / "test_output.txt")
    if not found:
        raise RuntimeError("official parser did not recognize test execution")
    report_path = log_dir / "report.json"
    summary = qualify(json.loads(report_path.read_text()), row["instance_id"], control,
                      statuses, spec.FAIL_TO_PASS, spec.PASS_TO_PASS)
    save(Path(f"{row['instance_id']}-{control}.json"), {
        **summary, "instanceId": row["instance_id"], "control": control,
        "imageId": image_id, "patchSha256": digest(patch.encode()),
        "reportSha256": digest(report_path.read_bytes()), "runId": run_id,
        "wallTimeSeconds": time.monotonic() - started, "completedAt": time.time(),
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--parquet", type=Path, required=True)
    parser.add_argument("--vendor", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--images", type=Path, help="JSON map of smoke IDs to local sha256 image IDs")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--check-evaluator", action="store_true", help="check locked imports/specifications without Docker")
    args = parser.parse_args()
    vendor = args.vendor.resolve()
    revision = subprocess.check_output(["git", "-C", str(vendor), "rev-parse", "HEAD"], text=True).strip()
    dirty = subprocess.check_output(["git", "-C", str(vendor), "status", "--porcelain"], text=True)
    if revision != EVALUATOR_COMMIT or dirty.strip():
        raise ValueError("official evaluator checkout must match the clean pinned revision")
    if digest(args.parquet.read_bytes()) != PARQUET_HASH:
        raise ValueError("parquet provenance mismatch")
    import pyarrow.parquet as pq
    rows = smoke_rows(json.loads(args.cohort.read_text()), pq.read_table(args.parquet).to_pylist())
    if args.execute or args.check_evaluator:
        check_environment(vendor, rows)
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    image_map = json.loads(args.images.read_text()) if args.images else {}
    manifest = {
        "cohortFingerprint": COHORT_HASH, "parquetSha256": PARQUET_HASH,
        "evaluatorCommit": revision, "bridgeSha256": digest(Path(__file__).read_bytes()),
        "dependencyLockSha256": digest(Path(__file__).with_name("swebench-requirements.lock").read_bytes()),
        "platform": "linux/amd64", "maxJobs": 4, "jobTimeoutSeconds": TIMEOUT,
        "providerAttempts": 0, "launchReady": False, "images": image_map,
        "evaluatorImportChecked": args.execute or args.check_evaluator,
        "baseControl": "direct run_instance; empty patch accepted by /bin/true; unchanged official grading",
        "containerPolicy": "local image IDs only; no network or mounts; 8GiB RAM; 2 CPUs; 512 PIDs",
        "tasks": [{"instanceId": row["instance_id"], "baseCommit": row["base_commit"],
                   "upstreamImage": "swebench/sweb.eval.x86_64."
                   + row["instance_id"].lower().replace("__", "_1776_") + ":latest"}
                  for row in rows],
    }
    save(output / "manifest.json", manifest)
    if not args.execute:
        print("Prepared two smoke tasks, four control jobs; no containers or model calls.")
        return
    if set(image_map) != {row["instance_id"] for row in rows} or not all(
            isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value)
            for value in image_map.values()):
        raise ValueError("execution requires exact local image IDs for both smoke tasks")
    import docker
    client = docker.from_env(timeout=60)
    client.ping()
    images = [client.images.get(value) for value in image_map.values()]
    if any(image.attrs["Architecture"] != "amd64" or image.attrs["Os"] != "linux" for image in images):
        raise ValueError("image platform mismatch")
    if sum(image.attrs["Size"] for image in images) > 50 * 1024**3:
        raise ValueError("smoke images exceed 50GiB size gate")
    save(output / "environment.json", {"python": sys.version, "docker": client.version(),
         "packages": sorted(f"{dist.metadata['Name']}=={dist.version}" for dist in distributions()),
         "images": [{"id": image.id, "repoDigests": image.attrs.get("RepoDigests", []),
                     "size": image.attrs["Size"]} for image in images]})
    try:
        for row in rows:
            for control in ("base", "gold"):
                run_id = "gov-" + digest(f"{output}/{row['instance_id']}/{control}".encode())[:20]
                save(output / f"{row['instance_id']}-{control}.started.json",
                     {"runId": run_id, "startedAt": time.time()})
                process = multiprocessing.get_context("fork").Process(
                    target=evaluate, args=(row, control, image_map[row["instance_id"]], run_id, output))
                process.start()
                try:
                    process.join(TIMEOUT)
                    if process.is_alive() or process.exitcode != 0:
                        raise RuntimeError("smoke control failed or timed out; stop without replacing tasks")
                finally:
                    if process.is_alive():
                        process.kill()
                    process.join()
                    # Exact name only; never prune unrelated user containers/images.
                    name = f"sweb.eval.{row['instance_id'].lower()}.{run_id}"
                    try:
                        client.containers.get(name).remove(force=True)
                    except docker.errors.NotFound:
                        pass
        save(output / "qualification.json", {"qualified": True, "completedJobs": 4,
             "providerAttempts": 0, "launchReady": False,
             "remainingGate": "repository executor isolation and trajectory accounting"})
    except BaseException as error:
        save(output / "failure.json", {"qualified": False, "errorType": type(error).__name__,
             "launchReady": False})
        raise


if __name__ == "__main__":
    main()
