import { createHash } from "node:crypto";
import type { DomainRejection } from "../core/decide.ts";
import type { RunDetail } from "../core/model.ts";

declare const commandIdBrand: unique symbol;
declare const workspaceIdBrand: unique symbol;

export type CommandId = string & Readonly<{ [commandIdBrand]: "CommandId" }>;
export type WorkspaceId = string &
  Readonly<{ [workspaceIdBrand]: "WorkspaceId" }>;

export type StartRunCommand = Readonly<{
  schemaVersion: 1;
  commandId: CommandId;
  workspaceId: WorkspaceId;
  origin: "cli";
  payloadHash: string;
  payload: Readonly<{ taskType: string }>;
}>;

export type CommandValidationError =
  | Readonly<{ kind: "InvalidCommandId"; value: string }>
  | Readonly<{ kind: "InvalidWorkspaceId"; value: string }>
  | Readonly<{ kind: "PayloadHashMismatch" }>;

export type CommandSubmission =
  | Readonly<{ kind: "accepted"; detail: RunDetail }>
  | Readonly<{ kind: "duplicate"; detail: RunDetail }>
  | Readonly<{ kind: "conflict"; commandId: CommandId }>
  | Readonly<{ kind: "invalid"; error: CommandValidationError }>
  | Readonly<{ kind: "rejected"; error: DomainRejection }>;

export function parseCommandId(
  value: string,
): CommandId | CommandValidationError {
  return validOpaqueId(value)
    ? (value as CommandId)
    : { kind: "InvalidCommandId", value };
}

export function parseWorkspaceId(
  value: string,
): WorkspaceId | CommandValidationError {
  return validOpaqueId(value)
    ? (value as WorkspaceId)
    : { kind: "InvalidWorkspaceId", value };
}

export function isCommandId(
  value: CommandId | CommandValidationError,
): value is CommandId {
  return typeof value === "string";
}

export function isWorkspaceId(
  value: WorkspaceId | CommandValidationError,
): value is WorkspaceId {
  return typeof value === "string";
}

export function makeStartRunCommand(
  commandId: CommandId,
  workspaceId: WorkspaceId,
  taskType: string,
): StartRunCommand {
  const payload = { taskType };
  return {
    schemaVersion: 1,
    commandId,
    workspaceId,
    origin: "cli",
    payload,
    payloadHash: hashPayload(payload),
  };
}

export function validateStartRunCommand(
  command: StartRunCommand,
): CommandValidationError | null {
  return command.payloadHash === hashPayload(command.payload)
    ? null
    : { kind: "PayloadHashMismatch" };
}

function hashPayload(payload: Readonly<{ taskType: string }>): string {
  return createHash("sha256")
    .update(JSON.stringify({ taskType: payload.taskType }))
    .digest("hex");
}

function validOpaqueId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value);
}
