import { Box, Text } from "ink";

import type { TuiStep } from "../state/tui-state.js";

export interface AgentStatusRowProps {
  step: TuiStep;
  index: number;
}

export function AgentStatusRow({ step, index }: AgentStatusRowProps) {
  const marker = statusMarker(step.status);
  const attempt = step.attempt === undefined ? "" : ` attempt ${step.attempt}`;
  const reason =
    step.failureReason === undefined ? "" : ` - ${step.failureReason}`;

  return (
    <Box>
      <Text>
        {String(index + 1).padStart(2, "0")}. {marker} {step.label}
        {attempt}
        {reason}
      </Text>
    </Box>
  );
}

function statusMarker(status: TuiStep["status"]): string {
  switch (status) {
    case "pending":
      return "[ ]";
    case "running":
      return "[~]";
    case "validating":
      return "[?]";
    case "completed":
      return "[x]";
    case "failed":
      return "[!]";
  }
}
