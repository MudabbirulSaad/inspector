import { spawn } from "node:child_process";

import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunStreamEvent,
} from "../../ports/index.js";

export const processAdapterBoundary = "adapters.process" as const;

export class NodeProcessRunner implements ProcessRunner {
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const startedAt = new Date().toISOString();

    return new Promise<ProcessRunResult>((resolve) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env === undefined ? process.env : { ...process.env, ...request.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const streamingEvents: ProcessRunStreamEvent[] = [];
      const streamingCallbacks: Promise<void>[] = [];
      let timedOut = false;
      let processError: Error | undefined;
      const timeout =
        request.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
            }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        emitStreamingEvent("stdout", chunk.toString("utf8"));
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        emitStreamingEvent("stderr", chunk.toString("utf8"));
      });

      child.on("error", (error) => {
        processError = error;
      });

      child.on("close", (code) => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        const completedAt = new Date().toISOString();
        const exitCode = timedOut ? 1 : (code ?? 1);
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");

        void Promise.all(streamingCallbacks).then(() => resolve({
          stdout,
          stderr,
          exitCode,
          startedAt,
          completedAt,
          streamingEvents,
          failureReason:
            exitCode === 0
              ? undefined
              : timedOut
                ? `process timed out after ${request.timeoutMs}ms`
                : (processError?.message ?? `process exited with code ${exitCode}`),
        }));
      });

      function emitStreamingEvent(
        kind: ProcessRunStreamEvent["kind"],
        message: string,
      ): void {
        const event: ProcessRunStreamEvent = {
          timestamp: new Date().toISOString(),
          kind,
          message,
        };
        streamingEvents.push(event);
        streamingCallbacks.push(Promise.resolve(request.onStreamingEvent?.(event)));
      }
    });
  }
}
