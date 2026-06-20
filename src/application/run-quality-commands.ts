import type { DetectedCommands } from "./detect-repository-commands.js";
import {
  parseAllowedValidationCommand,
  runAllowedValidationCommand,
} from "./validation-command-policy.js";
import type {
  ProcessRunner,
  QualityCommandReportWriter,
  RunWorkspace,
} from "../ports/index.js";

export type QualityCommandStatus = "passed" | "failed" | "blocked" | "timeout";

export interface QualityCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: QualityCommandStatus;
}

export interface QualityCommandReport {
  skipped?: boolean;
  reason?: string;
  commands: QualityCommandResult[];
}

export interface RunQualityCommandsRequest {
  detectedCommands: DetectedCommands;
  cwd: string;
  runner: ProcessRunner;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface WriteQualityCommandReportRequest {
  workspace: RunWorkspace;
  report: QualityCommandReport;
  writer: QualityCommandReportWriter;
}

const runnableCategories = new Set(["test", "typecheck", "lint", "build"]);

export async function runQualityCommands(
  request: RunQualityCommandsRequest,
): Promise<QualityCommandReport> {
  if (request.enabled !== true) {
    return {
      skipped: true,
      reason:
        "Quality command execution is disabled by default. Use --run-quality-commands or runQualityCommands: true only for trusted repositories.",
      commands: [],
    };
  }

  const results: QualityCommandResult[] = [];

  for (const detected of request.detectedCommands.commands) {
    if (!runnableCategories.has(detected.category)) {
      continue;
    }

    const parsed = parseValidationCommandForReport(detected.command);
    if (parsed.status === "blocked") {
      results.push({
        command: detected.command,
        args: [],
        exitCode: null,
        stdout: "",
        stderr: parsed.reason,
        durationMs: 0,
        status: "blocked",
      });
      continue;
    }

    const result = await runAllowedValidationCommand({
      command: detected.command,
      cwd: request.cwd,
      runner: request.runner,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    });

    results.push({
      command: parsed.command,
      args: parsed.args,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: durationMs(result.startedAt, result.completedAt),
      status: statusForResult(result.exitCode, result.failureReason),
    });
  }

  return { commands: results };
}

export async function writeQualityCommandReport(
  request: WriteQualityCommandReportRequest,
): Promise<{ path: string }> {
  return request.writer.writeQualityCommandReport({
    workspace: request.workspace,
    content: `${JSON.stringify(request.report, null, 2)}\n`,
  });
}

function durationMs(startedAt: string, completedAt: string): number {
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function statusForResult(
  exitCode: number,
  failureReason: string | undefined,
): QualityCommandStatus {
  if (exitCode === 0) {
    return "passed";
  }

  return failureReason?.startsWith("process timed out after") === true
    ? "timeout"
    : "failed";
}

function parseValidationCommandForReport(
  command: string,
):
  | { status: "allowed"; command: string; args: string[] }
  | { status: "blocked"; reason: string } {
  try {
    return { status: "allowed", ...parseAllowedValidationCommand(command) };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
