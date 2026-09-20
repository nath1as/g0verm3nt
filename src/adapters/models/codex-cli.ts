import type {
  ModelRawArtifact,
  ModelToolCall,
  ModelUsage,
  TypedModelGateway,
  TypedModelRequest,
  TypedModelResponse,
} from "./typed.ts";

type JsonObject = Readonly<Record<string, unknown>>;

export const codexCliProfileRef =
  "codex-cli/read-only-ephemeral-ignore-config-and-rules@1";

export type CodexCliProcess = Readonly<{
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
}>;

export type CodexCliSpawnOptions = Readonly<{
  cwd: string;
  stdout: "pipe";
  stderr: "pipe";
}>;

export type CodexCliSpawn = (
  command: readonly string[],
  options: CodexCliSpawnOptions,
) => CodexCliProcess;

export type CodexCliGatewayOptions = Readonly<{
  /** The caller must provision a disposable directory for each live attempt. */
  workingDirectory: string;
  executable?: string;
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
  maxArtifactChars?: number;
  spawn?: CodexCliSpawn;
}>;

const defaultSpawn: CodexCliSpawn = (command, options) =>
  Bun.spawn([...command], options);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonl(stdout: string): readonly JsonObject[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`invalid Codex JSONL event at line ${index + 1}`);
      }
      if (!isObject(value))
        throw new Error(`invalid Codex JSONL event at line ${index + 1}`);
      return value;
    });
}

function eventMessage(event: JsonObject): string | undefined {
  const error = event.error;
  if (typeof error === "string" && error.trim()) return error;
  if (isObject(error) && typeof error.message === "string" && error.message)
    return error.message;
  if (typeof event.message === "string" && event.message) return event.message;
  return undefined;
}

function tokenValue(usage: JsonObject, key: string): number | null {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function sumTokenUsage(completed: readonly JsonObject[]): ModelUsage {
  const fields = [
    ["input_tokens", "inputTokens"],
    ["cached_input_tokens", "cachedInputTokens"],
    ["output_tokens", "outputTokens"],
  ] as const;
  const totals: Record<string, number | null> = {};
  for (const [source, target] of fields) {
    let total = 0;
    let known = true;
    for (const event of completed) {
      const usage = isObject(event.usage) ? event.usage : {};
      const value = tokenValue(usage, source);
      if (value === null) known = false;
      else total += value;
    }
    totals[target] = known ? total : null;
  }
  const inputTokens = totals.inputTokens ?? null;
  const cachedInputTokens = totals.cachedInputTokens ?? null;
  const outputTokens = totals.outputTokens ?? null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens:
      inputTokens === null || outputTokens === null
        ? null
        : inputTokens + outputTokens,
    known:
      inputTokens !== null &&
      cachedInputTokens !== null &&
      outputTokens !== null,
  };
}

function completedItems(events: readonly JsonObject[]): readonly JsonObject[] {
  const ids = new Set<string>();
  const result: JsonObject[] = [];
  for (const event of events) {
    if (event.type !== "item.completed" || !isObject(event.item)) continue;
    const item = event.item;
    const id = typeof item.id === "string" ? item.id : undefined;
    if (id !== undefined) {
      if (ids.has(id)) continue;
      ids.add(id);
    }
    result.push(item);
  }
  return result;
}

function itemToolCall(
  item: JsonObject,
  index: number,
): ModelToolCall | undefined {
  const type = item.type;
  if (type !== "mcp_tool_call" && type !== "web_search") return undefined;
  const id = typeof item.id === "string" ? item.id : `observed-tool-${index}`;
  const name = typeof item.name === "string" ? item.name : type;
  return { id, name, argumentsJson: JSON.stringify(item) };
}

function boundedArtifact(
  stdout: string,
  stderr: string,
  maxChars: number,
): ModelRawArtifact {
  const combined = stdout.length + stderr.length;
  if (combined <= maxChars)
    return { format: "codex-cli-jsonl@1", stdout, stderr, truncated: false };
  const stdoutChars = Math.min(stdout.length, maxChars);
  const stderrChars = Math.max(0, maxChars - stdoutChars);
  return {
    format: "codex-cli-jsonl@1",
    stdout: stdout.slice(0, stdoutChars),
    stderr: stderr.slice(0, stderrChars),
    truncated: true,
  };
}

function cancelled(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("operation cancelled", "AbortError");
}

/**
 * Uses the locally authenticated Codex CLI as an opt-in external-agent executor.
 * Explicit flags keep P2 runs isolated from ambient rules and user settings.
 */
export class CodexCliGateway implements TypedModelGateway {
  readonly #executable: string;
  readonly #workingDirectory: string;
  readonly #timeoutMs: number;
  readonly #maxArtifactChars: number;
  readonly #spawn: CodexCliSpawn;
  readonly #reasoningEffort: CodexCliGatewayOptions["reasoningEffort"];

  constructor(options: CodexCliGatewayOptions) {
    if (!options.workingDirectory)
      throw new Error("Codex CLI working directory is required");
    if (options.timeoutMs !== undefined && options.timeoutMs <= 0)
      throw new Error("Codex CLI timeout must be positive");
    this.#executable = options.executable ?? "codex";
    this.#workingDirectory = options.workingDirectory;
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#maxArtifactChars = options.maxArtifactChars ?? 65_536;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#reasoningEffort = options.reasoningEffort;
  }

  async complete(
    request: TypedModelRequest,
    signal: AbortSignal,
  ): Promise<TypedModelResponse> {
    if (signal.aborted) throw cancelled(signal);
    const child = this.#spawn(
      [
        this.#executable,
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-m",
        request.modelRef,
        ...(this.#reasoningEffort === undefined
          ? []
          : ["-c", `model_reasoning_effort="${this.#reasoningEffort}"`]),
        request.prompt,
      ],
      { cwd: this.#workingDirectory, stdout: "pipe", stderr: "pipe" },
    );
    let timedOut = false;
    const abort = () => child.kill();
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, this.#timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (signal.aborted) throw cancelled(signal);
      if (timedOut)
        throw new Error(`Codex CLI timed out after ${this.#timeoutMs}ms`);
      if (exitCode !== 0)
        throw new Error(stderr.trim() || `codex exited with ${exitCode}`);

      const events = parseJsonl(stdout);
      const terminalError = events.find(
        (event) => event.type === "turn.failed" || event.type === "error",
      );
      if (terminalError !== undefined)
        throw new Error(
          eventMessage(terminalError) ?? "Codex reported a terminal error",
        );
      const completed = events.filter(
        (event) => event.type === "turn.completed",
      );
      if (completed.length === 0)
        throw new Error("Codex JSONL stream ended without turn.completed");

      const items = completedItems(events);
      const messages = items
        .filter((item) => item.type === "agent_message")
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .filter(Boolean);
      const terminalMessage = messages.at(-1) ?? "";
      const toolCalls = items.flatMap<ModelToolCall>((item, index) => {
        const call = itemToolCall(item, index);
        return call === undefined ? [] : [call];
      });
      const commandExecutions = items.filter(
        (item) => item.type === "command_execution",
      ).length;
      return {
        requestId: request.requestId,
        modelRef: request.modelRef,
        // Codex may emit progress messages before its terminal assistant turn.
        // The raw JSONL retains those messages; callers receive the final answer.
        text: terminalMessage,
        toolCalls,
        usage: sumTokenUsage(completed),
        accounting: {
          executorAttempts: 1,
          modelCalls: null,
          commandExecutions,
          toolCalls: toolCalls.length,
        },
        rawArtifact: boundedArtifact(stdout, stderr, this.#maxArtifactChars),
        finish: "stop",
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
}
