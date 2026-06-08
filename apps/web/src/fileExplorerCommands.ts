export type FileExplorerCommand = "toggleTree" | "showTree" | "focusSearch";

export function parseFileExplorerCommand(value: unknown): FileExplorerCommand | undefined {
  return value === "toggleTree" || value === "showTree" || value === "focusSearch"
    ? value
    : undefined;
}
