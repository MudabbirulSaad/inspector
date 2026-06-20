import { Box, Text } from "ink";

import { AgentStatusRow } from "./AgentStatusRow.js";
import type { TuiStep } from "../state/tui-state.js";

export interface StepListProps {
  steps: TuiStep[];
}

export function StepList({ steps }: StepListProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Specialist Agents</Text>
      {steps.map((step, index) => (
        <AgentStatusRow key={step.agentId} step={step} index={index} />
      ))}
    </Box>
  );
}
