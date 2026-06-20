import { Box } from "ink";

import { ConfirmDanger, type ConfirmDangerProps } from "./components/ConfirmDanger.js";
import { CurrentActivity } from "./components/CurrentActivity.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { Header } from "./components/Header.js";
import { RunSummary } from "./components/RunSummary.js";
import { StepList } from "./components/StepList.js";
import type { TuiState } from "./state/tui-state.js";

export interface TuiAppProps {
  state: TuiState;
  danger?: ConfirmDangerProps;
}

export function TuiApp({ state, danger }: TuiAppProps) {
  return (
    <Box flexDirection="column">
      <Header run={state.run} />
      {danger === undefined ? null : <ConfirmDanger {...danger} />}
      <StepList steps={state.steps} />
      <CurrentActivity activity={state.currentActivity} />
      <ErrorPanel error={state.error} />
      <RunSummary summary={state.summary} />
    </Box>
  );
}
