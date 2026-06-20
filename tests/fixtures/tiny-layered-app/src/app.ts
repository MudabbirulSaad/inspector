import { createGreeting } from "./domain/greeting.js";

export function renderGreeting(name: string): string {
  return createGreeting({ name });
}
