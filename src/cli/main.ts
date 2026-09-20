import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CodexCliGateway,
  codexCliProfileRef,
} from "../adapters/models/codex-cli.ts";
import { FakeModelGateway } from "../adapters/models/fake.ts";
import {
  isCommandId,
  isWorkspaceId,
  makeStartRunCommand,
  parseCommandId,
  parseWorkspaceId,
} from "../codecs/commands.ts";
import {
  m3DevelopmentComparisonProtocol,
  selectM3DevelopmentVariant,
} from "../experiments/m3-fixed-comparison.ts";
import {
  normalizationBaseline,
  normalizationRefs,
  normalizationRevised,
} from "../fixtures/normalization.ts";
import {
  getTypescriptRefactorTask,
  typescriptRefactorTask,
} from "../fixtures/typescript-refactor.ts";
import { GovernmentApplication } from "../runtime/application.ts";
import { assembleM3ComparisonCohortReport } from "../runtime/m3-comparison-cohort.ts";
import { runM3TypescriptRefactor } from "../runtime/m3-typescript-refactor-run.ts";
import { runNormalizationDemo } from "../runtime/normalization-demo.ts";
import { executeDurableProviderAttempt } from "../runtime/provider-attempt.ts";
import { SqliteRunStore } from "../storage/sqlite.ts";

type ParsedArguments = Readonly<{
  stateDirectory: string;
  command: string | undefined;
  values: string[];
  json: boolean;
  cancelAfterMilliseconds: number | undefined;
  commandId: string | undefined;
  workspaceId: string;
  providerModelRef: string;
  providerTimeoutMilliseconds: number;
}>;

const arguments_ = parseArguments(Bun.argv.slice(2));
if (arguments_.command === undefined) usage();
let store: SqliteRunStore;
try {
  store = await SqliteRunStore.open(arguments_.stateDirectory);
} catch (error) {
  exitWithError(error instanceof Error ? error.message : String(error));
}
const application = new GovernmentApplication(store, new FakeModelGateway());

try {
  switch (arguments_.command) {
    case "init":
      write(
        { stateDirectory: arguments_.stateDirectory, status: "initialized" },
        arguments_.json,
      );
      break;
    case "run": {
      const taskType = arguments_.values[0];
      if (taskType === undefined) usage("run requires a task type");
      const signal =
        arguments_.cancelAfterMilliseconds === undefined
          ? undefined
          : AbortSignal.timeout(arguments_.cancelAfterMilliseconds);
      const commandId = parseCommandId(
        arguments_.commandId ?? crypto.randomUUID(),
      );
      if (!isCommandId(commandId)) exitWithError("invalid command ID");
      const workspaceId = parseWorkspaceId(arguments_.workspaceId);
      if (!isWorkspaceId(workspaceId)) exitWithError("invalid workspace ID");
      const command = makeStartRunCommand(commandId, workspaceId, taskType);
      write(await application.submitStartRun(command, signal), arguments_.json);
      break;
    }
    case "fixture":
      write(
        {
          manifest: normalizationRefs.manifest,
          baseline: normalizationBaseline.ref,
          revised: normalizationRevised.ref,
          input: normalizationRefs.input,
          output: normalizationRefs.output,
        },
        arguments_.json,
      );
      break;
    case "normalization-demo":
      write(
        runNormalizationDemo(store, "2026-09-20T00:00:00.000Z"),
        arguments_.json,
      );
      break;
    case "provider-smoke": {
      const runId = `provider-smoke/${crypto.randomUUID()}`;
      const attemptId = `provider-attempt/${crypto.randomUUID()}`;
      const workingDirectory = mkdtempSync(
        join(arguments_.stateDirectory, "provider-work-"),
      );
      const controller = AbortSignal.timeout(
        arguments_.providerTimeoutMilliseconds,
      );
      const occurredAt = () => new Date().toISOString();
      store.createRun({
        id: runId,
        taskType: "provider-smoke",
        status: "running",
        createdAt: occurredAt(),
        completedAt: null,
        outcome: null,
      });
      let failure: string | undefined;
      try {
        const response = await executeDurableProviderAttempt(
          store,
          new CodexCliGateway({
            workingDirectory,
            timeoutMs: arguments_.providerTimeoutMilliseconds,
          }),
          {
            attemptId,
            runId,
            executorRef: "codex-cli@1",
            configurationFingerprint: codexCliProfileRef,
            request: {
              requestId: `${attemptId}/request/1`,
              runId,
              modelRef: arguments_.providerModelRef,
              prompt: "Reply with exactly: provider-boundary-ready",
            },
            occurredAt,
          },
          controller,
        );
        store.completeRun(
          runId,
          "succeeded",
          "provider terminal response recorded; task quality unevaluated",
          occurredAt(),
        );
        write(
          {
            runId,
            attempt: store.getProviderAttempt(attemptId),
            text: response.text,
          },
          arguments_.json,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.completeRun(runId, "failed", message, occurredAt());
        failure = `provider attempt ${attemptId} is indeterminate: ${message}`;
      } finally {
        rmSync(workingDirectory, { recursive: true, force: true });
      }
      if (failure !== undefined) exitWithError(failure);
      break;
    }
    case "m3-refactor": {
      const variantRef = arguments_.values[0] ?? "m3/harness-default@1";
      const taskRef = arguments_.values[1] ?? typescriptRefactorTask.ref;
      const task = getTypescriptRefactorTask(taskRef);
      if (task === undefined) usage(`unknown M3 task: ${taskRef}`);
      const runId = `m3-refactor/${crypto.randomUUID()}`;
      const attemptId = `provider-attempt/${crypto.randomUUID()}`;
      const evaluationId = `m3-evaluation/${crypto.randomUUID()}`;
      const workingDirectory = mkdtempSync(
        join(arguments_.stateDirectory, "m3-refactor-work-"),
      );
      try {
        const result = await runM3TypescriptRefactor(
          store,
          new CodexCliGateway({
            workingDirectory,
            timeoutMs: arguments_.providerTimeoutMilliseconds,
          }),
          {
            runId,
            attemptId,
            evaluationId,
            variantRef,
            modelRef: arguments_.providerModelRef,
            executorRef: "codex-cli@1",
            configurationFingerprint: codexCliProfileRef,
            task,
            occurredAt: () => new Date().toISOString(),
          },
          AbortSignal.timeout(arguments_.providerTimeoutMilliseconds),
        );
        write(
          {
            ...result,
            attempt: store.getProviderAttempt(attemptId),
            evaluation:
              result.evaluationId === null
                ? null
                : store.getM3TaskEvaluation(result.evaluationId),
          },
          arguments_.json,
        );
      } finally {
        rmSync(workingDirectory, { recursive: true, force: true });
      }
      break;
    }
    case "m3-cohort-record": {
      const cohortRef = arguments_.values[0];
      const evaluationId = arguments_.values[1];
      if (cohortRef === undefined || evaluationId === undefined)
        usage("m3-cohort-record requires a cohort reference and evaluation ID");
      write(
        store.recordM3EvaluationCohortObservation(
          cohortRef,
          evaluationId,
          new Date().toISOString(),
        ),
        arguments_.json,
      );
      break;
    }
    case "m3-development-report": {
      const cohortRef = arguments_.values[0];
      if (cohortRef === undefined)
        usage("m3-development-report requires a cohort reference");
      const report = assembleM3ComparisonCohortReport(
        store,
        cohortRef,
        m3DevelopmentComparisonProtocol,
      );
      write(
        { report, selection: selectM3DevelopmentVariant(report) },
        arguments_.json,
      );
      break;
    }
    case "runs":
      write(application.runs(), arguments_.json);
      break;
    case "inspect": {
      const resource = arguments_.values[0];
      const identifier = arguments_.values[1];
      if (resource === undefined) usage("inspect requires a resource");
      if (resource === "run") {
        if (identifier === undefined) usage("inspect run requires a run ID");
        const detail = application.inspect(identifier);
        if (detail === null) exitWithError(`run not found: ${identifier}`);
        write(detail, arguments_.json);
        break;
      }
      if (resource === "head") {
        if (identifier === undefined) usage("inspect head requires a head key");
        const head = store.getGraphHead(identifier);
        if (head === null) exitWithError(`graph head not found: ${identifier}`);
        write(head, arguments_.json);
        break;
      }
      if (resource === "proposal") {
        if (identifier === undefined)
          usage("inspect proposal requires a proposal ID");
        const proposal = store.getGraphProposal(identifier);
        if (proposal === null)
          exitWithError(`graph proposal not found: ${identifier}`);
        write(
          {
            proposal,
            dependencies: store.listGraphProposalDependencies(identifier),
          },
          arguments_.json,
        );
        break;
      }
      if (resource === "dependency") {
        if (identifier === undefined)
          usage("inspect dependency requires a dependency reference");
        const status = store.getGraphDependencyStatus(identifier);
        if (status === null)
          exitWithError(`dependency not found: ${identifier}`);
        write(
          {
            status,
            proposals: store.listGraphProposalsDependingOn(identifier),
          },
          arguments_.json,
        );
        break;
      }
      if (resource === "checkpoint") {
        if (identifier === undefined)
          usage("inspect checkpoint requires a checkpoint ID");
        const checkpoint = store.getCompositionCheckpoint(identifier);
        if (checkpoint === null)
          exitWithError(`composition checkpoint not found: ${identifier}`);
        write(checkpoint, arguments_.json);
        break;
      }
      if (resource === "cohort") {
        write(store.listM3CohortObservations(), arguments_.json);
        break;
      }
      if (resource === "m3-cohort") {
        if (identifier === undefined)
          usage("inspect m3-cohort requires a cohort reference");
        write(
          store.listM3EvaluationCohortObservations(identifier),
          arguments_.json,
        );
        break;
      }
      if (resource === "attempt") {
        if (identifier === undefined) usage("inspect attempt requires an ID");
        const attempt = store.getProviderAttempt(identifier);
        if (attempt === null)
          exitWithError(`provider attempt not found: ${identifier}`);
        write(attempt, arguments_.json);
        break;
      }
      if (resource === "evaluation") {
        if (identifier === undefined)
          usage("inspect evaluation requires an ID");
        const evaluation = store.getM3TaskEvaluation(identifier);
        if (evaluation === null)
          exitWithError(`M3 task evaluation not found: ${identifier}`);
        write(evaluation, arguments_.json);
        break;
      }
      if (resource === "composition") {
        write(store.getSharedCompositionView(), arguments_.json);
        break;
      }
      if (resource === "relation") {
        if (identifier === undefined)
          usage("inspect relation requires a relation ID");
        const relation = store.getCompositionRelation(identifier);
        if (relation === null)
          exitWithError(`composition relation not found: ${identifier}`);
        write(relation, arguments_.json);
        break;
      }
      usage(`unknown inspect resource: ${resource}`);
      break;
    }
    default:
      usage(`unknown command: ${arguments_.command}`);
  }
} finally {
  await store.close();
}

function parseArguments(values: readonly string[]): ParsedArguments {
  let stateDirectory = resolve(".government");
  let json = false;
  let cancelAfterMilliseconds: number | undefined;
  let commandId: string | undefined;
  let workspaceId = "local";
  let providerModelRef = "gpt-6-astra";
  let providerTimeoutMilliseconds = 60_000;
  const remaining: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    if (value === "--json") json = true;
    else if (value === "--state-dir") {
      const directory = values[index + 1];
      if (directory === undefined) usage("--state-dir requires a path");
      stateDirectory = resolve(directory);
      index += 1;
    } else if (value === "--cancel-after-ms") {
      const duration = values[index + 1];
      if (duration === undefined || !/^\d+$/.test(duration))
        usage("--cancel-after-ms requires a non-negative integer");
      cancelAfterMilliseconds = Number(duration);
      index += 1;
    } else if (value === "--command-id") {
      const id = values[index + 1];
      if (id === undefined) usage("--command-id requires an ID");
      commandId = id;
      index += 1;
    } else if (value === "--workspace-id") {
      const id = values[index + 1];
      if (id === undefined) usage("--workspace-id requires an ID");
      workspaceId = id;
      index += 1;
    } else if (value === "--model") {
      const modelRef = values[index + 1];
      if (modelRef === undefined || !modelRef.trim())
        usage("--model requires a model reference");
      providerModelRef = modelRef;
      index += 1;
    } else if (value === "--provider-timeout-ms") {
      const duration = values[index + 1];
      if (
        duration === undefined ||
        !/^\d+$/.test(duration) ||
        Number(duration) <= 0
      )
        usage("--provider-timeout-ms requires a positive integer");
      providerTimeoutMilliseconds = Number(duration);
      index += 1;
    } else remaining.push(value);
  }
  return {
    stateDirectory,
    command: remaining[0],
    values: remaining.slice(1),
    json,
    cancelAfterMilliseconds,
    commandId,
    workspaceId,
    providerModelRef,
    providerTimeoutMilliseconds,
  };
}

function write(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(message?: string): never {
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: government [--state-dir <path>] [--workspace-id <id>] <init|run|runs|inspect|fixture|normalization-demo|provider-smoke|m3-refactor|m3-cohort-record|m3-development-report> [resource] [id] [--command-id <id>] [--cancel-after-ms <n>] [--model <ref>] [--provider-timeout-ms <n>] [--json]\n",
  );
  process.exit(2);
}

function exitWithError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
