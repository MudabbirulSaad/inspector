import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "../../ports/index.js";

export const processAdapterBoundary = "adapters.process" as const;

export class PlaceholderProcessRunner implements ProcessRunner {
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    void request;

    throw new Error("ProcessRunner adapter is not implemented yet.");
  }
}
