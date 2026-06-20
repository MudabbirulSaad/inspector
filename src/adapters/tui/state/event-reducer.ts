import type { InspectionEvent } from "../../../ports/index.js";
import {
  createInitialTuiState,
  type TuiAgentStatus,
  type TuiState,
  type TuiStep,
} from "./tui-state.js";

export { createInitialTuiState };

export function reduceInspectionEvent(
  state: TuiState,
  event: InspectionEvent,
): TuiState {
  switch (event.type) {
    case "run.started":
      return {
        ...state,
        run: {
          runId: event.runId,
          repoPath: event.repoPath,
          docsPath: event.docsPath,
          dataPath: event.dataPath,
        },
        currentActivity: { message: "Preparing inspection run" },
      };
    case "stage.started":
      return {
        ...state,
        currentActivity: { message: event.label },
      };
    case "agent.started":
      return updateStep(state, event.agentId, {
        status: "running",
        attempt: event.attempt,
        failureReason: undefined,
        currentActivity: { agentId: event.agentId, message: event.task },
      });
    case "agent.activity":
      return {
        ...state,
        currentActivity: {
          agentId: event.agentId,
          message: event.message,
        },
      };
    case "agent.output.received":
      return updateStep(state, event.agentId, {
        status: "validating",
        attempt: event.attempt,
      });
    case "agent.schema.passed":
      return updateStep(state, event.agentId, {
        status: "validating",
        attempt: event.attempt,
      });
    case "agent.evidence.passed":
      return updateStep(state, event.agentId, {
        status: "completed",
        attempt: event.attempt,
        currentActivity: {
          agentId: event.agentId,
          message: `Evidence validated across ${event.citedFiles} cited file(s)`,
        },
      });
    case "agent.failed": {
      const label = stepLabel(state.steps, event.agentId);
      const reason = `${label} failed: ${event.reason}`;
      return updateStep(state, event.agentId, {
        status: "failed",
        attempt: event.attempt,
        failureReason: event.reason,
        error: {
          reason,
          nextAction:
            "Inspect the run data artifacts, fix the failed output, then resume the inspection.",
        },
      });
    }
    case "qa.completed":
      return {
        ...state,
        summary: {
          status: "completed",
          approved: event.approved,
          rejected: event.rejected,
          issues: event.issues,
          docsPath: state.summary?.docsPath,
          dataPath: state.summary?.dataPath,
        },
      };
    case "docs.written":
      return {
        ...state,
        summary: {
          status: state.summary?.status ?? "completed",
          approved: state.summary?.approved,
          rejected: state.summary?.rejected,
          issues: state.summary?.issues,
          docsPath: event.path,
          dataPath: state.summary?.dataPath,
        },
      };
    case "rag.written":
      return state;
    case "run.completed":
      return {
        ...state,
        summary: {
          status: "completed",
          approved: state.summary?.approved,
          rejected: state.summary?.rejected,
          issues: state.summary?.issues,
          docsPath: event.docsPath,
          dataPath: event.dataPath,
        },
        currentActivity: { message: "Inspection complete" },
      };
    case "run.failed":
      return {
        ...state,
        summary: {
          status: "failed",
          docsPath: state.summary?.docsPath,
          dataPath: event.dataPath,
        },
        error: {
          reason: event.reason,
          nextAction:
            "Review the failure and run data artifacts before retrying or resuming.",
          dataPath: event.dataPath,
        },
      };
  }
}

function updateStep(
  state: TuiState,
  agentId: string,
  update: {
    status: TuiAgentStatus;
    attempt?: number;
    failureReason?: string;
    currentActivity?: TuiState["currentActivity"];
    error?: TuiState["error"];
  },
): TuiState {
  return {
    ...state,
    steps: state.steps.map((step) =>
      step.agentId === agentId
        ? {
            ...step,
            status: update.status,
            attempt: update.attempt ?? step.attempt,
            failureReason: update.failureReason,
          }
        : step,
    ),
    currentActivity: update.currentActivity ?? state.currentActivity,
    error: update.error ?? state.error,
  };
}

function stepLabel(steps: TuiStep[], agentId: string): string {
  return steps.find((step) => step.agentId === agentId)?.label ?? agentId;
}
