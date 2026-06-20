import type {
  RepositoryEntry,
  RepositoryReader,
} from "../ports/index.js";
import {
  detectPackageManager,
  type DetectedPackageManager,
  readPackageJson,
} from "./package-manifest.js";

export type CommandCategory =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "dev"
  | "format";

export interface DetectedCommand {
  category: CommandCategory;
  command: string;
  source: string;
}

export interface DetectedCommands {
  commands: DetectedCommand[];
  missing: CommandCategory[];
}

const commandCategories: CommandCategory[] = [
  "build",
  "dev",
  "format",
  "lint",
  "test",
  "typecheck",
];

export async function detectRepositoryCommands(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<DetectedCommands> {
  const packageJson = await readPackageJson(reader, entries);
  const packageManager = detectPackageManager(entries, packageJson);
  const scripts = packageJson?.scripts ?? {};
  const commands = commandCategories.flatMap((category) => {
    if (scripts[category] === undefined) {
      return [];
    }

    return [
      {
        category,
        command: renderPackageScriptCommand(packageManager.name, category),
        source: "package.json",
      },
    ];
  });

  return {
    commands,
    missing: commandCategories.filter(
      (category) => scripts[category] === undefined,
    ),
  };
}

function renderPackageScriptCommand(
  packageManager: DetectedPackageManager["name"],
  category: CommandCategory,
): string {
  if (category === "test") {
    return `${packageManager} test`;
  }

  if (packageManager === "npm") {
    return `npm run ${category}`;
  }

  return `${packageManager} ${category}`;
}
