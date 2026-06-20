import { renderGreeting } from "../app.js";

export function runCli(argv: string[] = process.argv): string {
  return renderGreeting(argv[2] ?? "world");
}
