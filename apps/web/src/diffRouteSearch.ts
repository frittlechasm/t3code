import { TurnId } from "@t3tools/contracts";
import { parseFileExplorerCommand, type FileExplorerCommand } from "./fileExplorerCommands";

export type RightPanelRoutePanel = "diff" | "files";

export interface DiffRouteSearch {
  panel?: RightPanelRoutePanel | undefined;
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  fileExplorerCommand?: FileExplorerCommand | undefined;
  fileExplorerCommandId?: string | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePanel(value: unknown): RightPanelRoutePanel | undefined {
  return value === "diff" || value === "files" ? value : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<
  T,
  "panel" | "diff" | "diffTurnId" | "diffFilePath" | "fileExplorerCommand" | "fileExplorerCommandId"
> {
  const {
    panel: _panel,
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    fileExplorerCommand: _fileExplorerCommand,
    fileExplorerCommandId: _fileExplorerCommandId,
    ...rest
  } = params;
  return rest as Omit<
    T,
    | "panel"
    | "diff"
    | "diffTurnId"
    | "diffFilePath"
    | "fileExplorerCommand"
    | "fileExplorerCommandId"
  >;
}

export function isDiffPanelOpen(search: Pick<DiffRouteSearch, "panel" | "diff">): boolean {
  return search.panel === "diff" || search.diff === "1";
}

export function getOpenRightPanel(search: DiffRouteSearch): RightPanelRoutePanel | null {
  if (search.panel) return search.panel;
  return search.diff === "1" ? "diff" : null;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const panel = normalizePanel(search.panel);
  const diff = panel === undefined && isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffOpen = panel === "diff" || diff === "1";
  const diffTurnIdRaw = diffOpen ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffFilePath =
    diffOpen && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;
  const fileExplorerCommand =
    panel === "files" ? parseFileExplorerCommand(search.fileExplorerCommand) : undefined;
  const fileExplorerCommandId =
    panel === "files" && fileExplorerCommand
      ? normalizeSearchString(search.fileExplorerCommandId)
      : undefined;

  return {
    ...(panel ? { panel } : {}),
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(fileExplorerCommand ? { fileExplorerCommand } : {}),
    ...(fileExplorerCommandId ? { fileExplorerCommandId } : {}),
  };
}
