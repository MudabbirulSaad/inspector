import { Box, Text } from "ink";

import type { TuiRunSummary } from "../state/tui-state.js";

export interface RunSummaryProps {
  summary?: TuiRunSummary;
}

export function RunSummary({ summary }: RunSummaryProps) {
  if (summary === undefined) {
    return null;
  }

  const findingCounts =
    summary.approved === undefined
      ? undefined
      : `${summary.approved} approved, ${summary.rejected ?? 0} rejected, ${
          summary.issues ?? 0
        } issue(s)`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Run Summary</Text>
      <Text>Status: {summary.status}</Text>
      {findingCounts === undefined ? null : <Text>Findings: {findingCounts}</Text>}
      {summary.docsPath === undefined ? null : <Text>Docs: {summary.docsPath}</Text>}
      {summary.dataPath === undefined ? null : <Text>Data: {summary.dataPath}</Text>}
    </Box>
  );
}
