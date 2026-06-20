import { Box, Text } from "ink";

import type { TuiActivity } from "../state/tui-state.js";

export interface CurrentActivityProps {
  activity?: TuiActivity;
}

export function CurrentActivity({ activity }: CurrentActivityProps) {
  const prefix =
    activity?.agentId === undefined ? "Current" : `Current (${activity.agentId})`;

  return (
    <Box marginBottom={1}>
      <Text>
        {prefix}: {activity?.message ?? "Waiting for inspection events"}
      </Text>
    </Box>
  );
}
