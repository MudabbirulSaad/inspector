import type {
  ProcessRunner,
  ProcessRunResult,
  ProcessRunStreamEvent,
} from "../ports/index.js";

export interface AllowedValidationCommand {
  command: string;
  args: string[];
}

export interface RunAllowedValidationCommandRequest {
  command: string;
  cwd: string;
  runner: ProcessRunner;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStreamingEvent?: (event: ProcessRunStreamEvent) => void | Promise<void>;
}

const allowedValidationCommands = new Map<string, AllowedValidationCommand>([
  ["npm test", { command: "npm", args: ["test"] }],
  ["npm run typecheck", { command: "npm", args: ["run", "typecheck"] }],
  ["npm run lint", { command: "npm", args: ["run", "lint"] }],
  ["npm run build", { command: "npm", args: ["run", "build"] }],
  ["pnpm test", { command: "pnpm", args: ["test"] }],
  ["pnpm typecheck", { command: "pnpm", args: ["typecheck"] }],
  ["pnpm lint", { command: "pnpm", args: ["lint"] }],
  ["pnpm build", { command: "pnpm", args: ["build"] }],
  ["pytest", { command: "pytest", args: [] }],
  ["uv run pytest", { command: "uv", args: ["run", "pytest"] }],
]);

export function parseAllowedValidationCommand(
  input: string,
): AllowedValidationCommand {
  const normalized = input.trim().replaceAll(/\s+/g, " ");

  if (containsDangerousShellSyntax(normalized)) {
    throw new Error(
      `Dangerous shell syntax is not allowed in validation commands: ${input}`,
    );
  }

  const allowed = allowedValidationCommands.get(normalized);

  if (allowed !== undefined) {
    return { command: allowed.command, args: [...allowed.args] };
  }

  throw new Error(`Validation command is not allowed: ${input}`);
}

export async function runAllowedValidationCommand(
  request: RunAllowedValidationCommandRequest,
): Promise<ProcessRunResult> {
  const parsed = parseAllowedValidationCommand(request.command);

  return request.runner.run({
    command: parsed.command,
    args: parsed.args,
    cwd: request.cwd,
    ...(request.env === undefined ? {} : { env: request.env }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.onStreamingEvent === undefined
      ? {}
      : { onStreamingEvent: request.onStreamingEvent }),
  });
}

function containsDangerousShellSyntax(input: string): boolean {
  return /[;&|<>`$()]/u.test(input);
}
