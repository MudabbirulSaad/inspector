export const portsBoundary = "ports" as const;

export interface PortRegistry {
  readonly boundary: typeof portsBoundary;
}
