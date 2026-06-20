import { Box, Text } from "ink";

export interface ConfirmDangerProps {
  codexMode: "standard" | "full-auto" | "yolo";
  runQualityCommands: boolean;
}

export function ConfirmDanger({
  codexMode,
  runQualityCommands,
}: ConfirmDangerProps) {
  const riskLabels = [
    codexMode === "standard" ? undefined : `Codex ${codexMode}`,
    runQualityCommands ? "trusted quality commands" : undefined,
  ].filter((label): label is string => label !== undefined);

  if (riskLabels.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="yellow">
        Danger confirmation required
      </Text>
      <Text>
        This run enables {riskLabels.join(" and ")}. Use only trusted
        repositories and commands.
      </Text>
    </Box>
  );
}
