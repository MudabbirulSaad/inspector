import { Box, Text } from "ink";

import type { TuiError } from "../state/tui-state.js";

export interface ErrorPanelProps {
  error?: TuiError;
}

export function ErrorPanel({ error }: ErrorPanelProps) {
  if (error === undefined) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="red">
        Failure
      </Text>
      <Text>Reason: {error.reason}</Text>
      <Text>Next: {error.nextAction}</Text>
      {error.dataPath === undefined ? null : <Text>Data: {error.dataPath}</Text>}
    </Box>
  );
}
