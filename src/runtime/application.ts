import { randomUUID } from "node:crypto";
import {
  type CommandSubmission,
  type StartRunCommand,
  validateStartRunCommand,
} from "../codecs/commands.ts";
import {
  type Decision,
  type DomainRejection,
  decide,
  type RunSettled,
  type RunStarted,
} from "../core/decide.ts";
import { evolve } from "../core/evolve.ts";
import { isRunId, parseRunId } from "../core/ids.ts";
import type {
  ModelGateway,
  Run,
  RunDetail,
  RunOutcome,
} from "../core/model.ts";
import {
  type RuntimeState,
  runtimeStateFromActiveRuns,
} from "../core/runtime-state.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";

type PreparedStart =
  | Readonly<{ kind: "accepted"; run: Run }>
  | Exclude<CommandSubmission, Readonly<{ kind: "accepted" }>>;

export class GovernmentApplication {
  readonly #controllers = new Map<string, AbortController>();
  #state: RuntimeState;
  #writer: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SqliteRunStore,
    private readonly model: ModelGateway,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {
    this.#state = runtimeStateFromActiveRuns(
      store
        .listRuns()
        .filter((run) => run.status === "running")
        .map((run) => ({
          id: requireRunId(run.id),
          taskType: run.taskType,
          status: "running" as const,
          revision: 0 as const,
        })),
    );
  }

  async run(
    taskType: string,
    externalSignal?: AbortSignal,
  ): Promise<RunDetail> {
    const run = await this.enqueue(() => this.persistUntrackedRun(taskType));
    return this.executeRun(run, externalSignal);
  }

  async submitStartRun(
    command: StartRunCommand,
    externalSignal?: AbortSignal,
  ): Promise<CommandSubmission> {
    const validationError = validateStartRunCommand(command);
    if (validationError !== null) {
      return { kind: "invalid", error: validationError };
    }
    const prepared = await this.enqueue(() => this.persistCommandRun(command));
    if (prepared.kind !== "accepted") return prepared;
    return {
      kind: "accepted",
      detail: await this.executeRun(prepared.run, externalSignal),
    };
  }

  private async executeRun(
    run: Run,
    externalSignal?: AbortSignal,
  ): Promise<RunDetail> {
    const controller = new AbortController();
    if (externalSignal?.aborted === true)
      controller.abort(externalSignal.reason);
    externalSignal?.addEventListener(
      "abort",
      () => controller.abort(externalSignal.reason),
      { once: true },
    );
    this.#controllers.set(run.id, controller);
    this.store.appendEvent(
      run.id,
      "OperationPlanned",
      this.now().toISOString(),
      { operation: "fake-model" },
    );

    let outcome: RunOutcome;
    try {
      const parts: string[] = [];
      for await (const part of this.model.stream(
        { runId: run.id, taskType: run.taskType },
        controller.signal,
      ))
        parts.push(part);
      outcome = { kind: "succeeded", text: parts.join(" ") };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      outcome = { kind: "cancelled" };
    } finally {
      this.#controllers.delete(run.id);
    }

    const completedAt = this.now().toISOString();
    if (outcome.kind === "succeeded") {
      this.store.appendEvent(run.id, "OperationObserved", completedAt, {
        output: outcome.text,
      });
      await this.enqueue(() =>
        this.persistSettlement(run.id, "succeeded", outcome.text, completedAt),
      );
    } else {
      await this.enqueue(() =>
        this.persistSettlement(run.id, "cancelled", null, completedAt),
      );
    }
    return this.inspect(run.id) ?? failMissing(run.id);
  }

  private persistCommandRun(command: StartRunCommand): PreparedStart {
    const existing = this.store.getCommandReceipt(command.commandId);
    if (existing !== null) {
      if (existing.payloadHash !== command.payloadHash) {
        return { kind: "conflict", commandId: command.commandId };
      }
      return {
        kind: "duplicate",
        detail: this.inspect(existing.runId) ?? failMissing(existing.runId),
      };
    }

    const admitted = this.admitRun(command.payload.taskType);
    if ("kind" in admitted) return { kind: "rejected", error: admitted };
    this.store.createRunWithReceipt(admitted.run, {
      commandId: command.commandId,
      payloadHash: command.payloadHash,
      runId: admitted.run.id,
    });
    this.#state = evolve(this.#state, admitted.event);
    return { kind: "accepted", run: admitted.run };
  }

  private persistUntrackedRun(taskType: string): Run {
    const admitted = this.admitRun(taskType);
    if ("kind" in admitted)
      throw new Error(`cannot start run: ${admitted.kind}`);
    this.store.createRun(admitted.run);
    this.#state = evolve(this.#state, admitted.event);
    return admitted.run;
  }

  private persistSettlement(
    runId: string,
    status: Extract<Run["status"], "succeeded" | "cancelled">,
    outcome: string | null,
    completedAt: string,
  ): void {
    const event = this.decideSettlement(runId);
    this.store.completeRun(runId, status, outcome, completedAt);
    this.#state = evolve(this.#state, event);
  }

  private admitRun(
    taskType: string,
  ): Readonly<{ event: RunStarted; run: Run }> | DomainRejection {
    const candidateId = parseRunId(this.newId());
    if (!isRunId(candidateId)) {
      throw new Error(
        `ID source produced an invalid run ID: ${candidateId.value}`,
      );
    }
    const result = decide(this.#state, {
      kind: "StartRun",
      runId: candidateId,
      taskType,
    });
    if (!isDecision(result)) return result;
    const event = result.events[0];
    if (event?.kind !== "RunStarted")
      throw new Error("StartRun decision had no RunStarted event");
    const admitted = evolve(this.#state, event).runs.get(candidateId);
    if (admitted === undefined)
      throw new Error("StartRun event did not create a run");
    return {
      event,
      run: {
        id: admitted.id,
        taskType: admitted.taskType,
        status: admitted.status,
        createdAt: this.now().toISOString(),
        completedAt: null,
        outcome: null,
      },
    };
  }

  private decideSettlement(runId: string): RunSettled {
    const result = decide(this.#state, {
      kind: "SettleRun",
      runId: requireRunId(runId),
    });
    if (!isDecision(result))
      throw new Error(`cannot settle run: ${result.kind}`);
    const event = result.events[0];
    if (event?.kind !== "RunSettled")
      throw new Error("SettleRun decision had no RunSettled event");
    return event;
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.#writer.then(operation, operation);
    this.#writer = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  cancel(runId: string): RunDetail | null {
    const controller = this.#controllers.get(runId);
    if (controller !== undefined) {
      controller.abort(new Error("cancelled by user"));
    } else {
      setTimeout(() => {
        this.#controllers.get(runId)?.abort(new Error("cancelled by user"));
      }, 0);
    }
    return this.inspect(runId);
  }

  inspect(runId: string): RunDetail | null {
    return this.store.getRun(runId);
  }

  runs(): readonly Run[] {
    return this.store.listRuns();
  }

  runtimeState(): RuntimeState {
    return { runs: new Map(this.#state.runs) };
  }
}

function failMissing(runId: string): never {
  throw new Error(`run ${runId} disappeared after completion`);
}

function isDecision(result: Decision | DomainRejection): result is Decision {
  return "events" in result;
}

function requireRunId(value: string) {
  const parsed = parseRunId(value);
  if (!isRunId(parsed))
    throw new Error(`persisted run has an invalid ID: ${parsed.value}`);
  return parsed;
}
