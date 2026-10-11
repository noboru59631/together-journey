export const modeStorageKey = "together.entryMode";
export type EntryMode = "pair" | "solo";
export function resolveEntryMode(stored: unknown): EntryMode | null {
  return stored === "pair" || stored === "solo" ? stored : null;
}
