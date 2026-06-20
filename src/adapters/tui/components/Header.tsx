import { Box, Text } from "ink";

import type { TuiRunInfo } from "../state/tui-state.js";

export interface HeaderProps {
  run?: TuiRunInfo;
}

export function Header({ run }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Inspector</Text>
      <Text>Repo: {run?.repoPath ?? "not selected"}</Text>
      <Text>Docs: {run?.docsPath ?? "pending"}</Text>
      <Text>Data: {run?.dataPath ?? "pending"}</Text>
    </Box>
  );
}
