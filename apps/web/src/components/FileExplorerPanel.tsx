import { FileTree as FileTreeComponent, useFileTree } from "@pierre/trees/react";
import type { FileTreeSortEntry, GitStatusEntry } from "@pierre/trees";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { ProjectEntry, ProjectReadFileResult, VcsStatusResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ExternalLinkIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useGitStatus } from "~/lib/gitStatusState";
import {
  projectListEntriesQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { openInPreferredEditor } from "../editorPreferences";
import { readLocalApi } from "../localApi";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolvePathLinkTarget } from "../terminal-links";
import { resolveThreadRouteRef } from "../threadRoutes";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type FileExplorerPanelMode = DiffPanelMode;

const EMPTY_PROJECT_ENTRIES: readonly ProjectEntry[] = [];
const EMPTY_GIT_STATUS_ENTRIES: readonly GitStatusEntry[] = [];
const FILE_TREE_PANE_WIDTH_STORAGE_KEY = "chat_file_explorer_tree_width";
const FILE_TREE_PANE_DEFAULT_WIDTH = 220;
const FILE_TREE_PANE_MIN_WIDTH = 180;
const FILE_TREE_PANE_MAX_WIDTH = 420;
const FILE_PREVIEW_MIN_WIDTH = 220;

function clampFileTreePaneWidth(width: number, containerWidth?: number): number {
  const maxWidth =
    containerWidth === undefined
      ? FILE_TREE_PANE_MAX_WIDTH
      : Math.max(
          FILE_TREE_PANE_MIN_WIDTH,
          Math.min(FILE_TREE_PANE_MAX_WIDTH, containerWidth - FILE_PREVIEW_MIN_WIDTH),
        );
  return Math.min(maxWidth, Math.max(FILE_TREE_PANE_MIN_WIDTH, Math.round(width)));
}

function readPersistedFileTreePaneWidth(): number {
  try {
    return clampFileTreePaneWidth(
      getLocalStorageItem(FILE_TREE_PANE_WIDTH_STORAGE_KEY, Schema.Number) ??
        FILE_TREE_PANE_DEFAULT_WIDTH,
    );
  } catch (error) {
    console.warn("Failed to read persisted file explorer tree width.", error);
    return FILE_TREE_PANE_DEFAULT_WIDTH;
  }
}

function directoriesFirstSort(left: FileTreeSortEntry, right: FileTreeSortEntry): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  return left.basename.localeCompare(right.basename, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function toTreePaths(entries: readonly ProjectEntry[]): readonly string[] {
  return entries.map((entry) => (entry.kind === "directory" ? `${entry.path}/` : entry.path));
}

function indexEntriesByTreePath(
  entries: readonly ProjectEntry[],
): ReadonlyMap<string, ProjectEntry> {
  const indexedEntries = new Map<string, ProjectEntry>();
  for (const entry of entries) {
    indexedEntries.set(entry.path, entry);
    if (entry.kind === "directory") {
      indexedEntries.set(`${entry.path}/`, entry);
    }
  }
  return indexedEntries;
}

function toFileTreeGitStatusEntries(status: VcsStatusResult | null): readonly GitStatusEntry[] {
  if (!status?.isRepo || status.workingTree.files.length === 0) {
    return EMPTY_GIT_STATUS_ENTRIES;
  }

  return status.workingTree.files.map((file) => ({
    path: file.path,
    status: "modified",
  }));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameOf(path: string): string {
  return path.split("/").at(-1) ?? path;
}

interface FileExplorerPanelProps {
  mode?: FileExplorerPanelMode;
}

function FilePreviewState(props: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
      {props.children}
    </div>
  );
}

function FilePreviewContent(props: {
  selectedPath: string | null;
  readFile: ProjectReadFileResult | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  if (!props.selectedPath) {
    return <FilePreviewState>Select a file to preview.</FilePreviewState>;
  }

  if (props.isLoading && props.readFile === undefined) {
    return <FilePreviewState>Loading preview...</FilePreviewState>;
  }

  if (props.error) {
    return <FilePreviewState>Unable to load preview.</FilePreviewState>;
  }

  const readFile = props.readFile;
  if (!readFile) {
    return <FilePreviewState>Preview unavailable.</FilePreviewState>;
  }

  if (readFile.state === "missing") {
    return <FilePreviewState>File no longer exists.</FilePreviewState>;
  }

  if (readFile.state === "binary") {
    return <FilePreviewState>Binary file preview is unavailable.</FilePreviewState>;
  }

  if (readFile.state === "too_large") {
    return (
      <FilePreviewState>
        File is too large to preview ({formatBytes(readFile.sizeBytes)}; limit{" "}
        {formatBytes(readFile.maxBytes)}).
      </FilePreviewState>
    );
  }

  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-foreground">
      {readFile.contents}
    </pre>
  );
}

export default function FileExplorerPanel({ mode = "inline" }: FileExplorerPanelProps) {
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProject = useStore((store) =>
    activeThread?.projectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeThread.projectId,
        })
      : undefined,
  );

  const environmentId = activeThread?.environmentId ?? null;
  const projectCwd = activeProject?.cwd ?? null;
  const [selectedRelativePath, setSelectedRelativePath] = useState<string | null>(null);
  const [treePaneWidth, setTreePaneWidth] = useState(readPersistedFileTreePaneWidth);

  const entriesQuery = useQuery(projectListEntriesQueryOptions({ environmentId, cwd: projectCwd }));
  const entries = entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const gitStatus = useGitStatus({ environmentId, cwd: projectCwd });
  const filePreviewQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId,
      cwd: projectCwd,
      relativePath: selectedRelativePath,
    }),
  );

  const treePaths = useMemo(() => toTreePaths(entries), [entries]);
  const entriesByTreePath = useMemo(() => indexEntriesByTreePath(entries), [entries]);
  const gitStatusEntries = useMemo(
    () => toFileTreeGitStatusEntries(gitStatus.data),
    [gitStatus.data],
  );
  const truncated = entriesQuery.data?.truncated ?? false;
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const treePaneWidthRef = useRef(treePaneWidth);
  const resizeStateRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const projectCwdRef = useRef<string | null>(projectCwd);
  const entriesByTreePathRef = useRef<ReadonlyMap<string, ProjectEntry>>(entriesByTreePath);
  projectCwdRef.current = projectCwd;
  entriesByTreePathRef.current = entriesByTreePath;
  treePaneWidthRef.current = treePaneWidth;

  const openSelectedFileInEditor = useCallback(() => {
    const cwd = projectCwdRef.current;
    const relativePath = selectedRelativePath;
    if (!cwd || !relativePath) return;
    const api = readLocalApi();
    if (!api) return;
    const targetPath = resolvePathLinkTarget(relativePath, cwd);
    void openInPreferredEditor(api, targetPath).catch((error) => {
      console.warn("Failed to open file explorer entry in editor.", error);
    });
  }, [selectedRelativePath]);

  const { model } = useFileTree({
    paths: treePaths,
    flattenEmptyDirectories: true,
    initialExpansion: 0,
    search: true,
    sort: directoriesFirstSort,
    gitStatus: gitStatusEntries,
    dragAndDrop: false,
    renaming: false,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1);
      if (!selectedPath) {
        setSelectedRelativePath(null);
        return;
      }
      const entry = entriesByTreePathRef.current.get(selectedPath);
      setSelectedRelativePath(entry?.kind === "file" ? entry.path : null);
    },
  });

  useEffect(() => {
    model.resetPaths(treePaths);
  }, [model, treePaths]);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(() => {
    const containerWidth = splitContainerRef.current?.clientWidth;
    const clampedWidth = clampFileTreePaneWidth(treePaneWidthRef.current, containerWidth);
    if (clampedWidth === treePaneWidthRef.current) return;
    treePaneWidthRef.current = clampedWidth;
    setTreePaneWidth(clampedWidth);
  }, [mode]);

  const persistTreePaneWidth = useCallback((width: number) => {
    try {
      setLocalStorageItem(FILE_TREE_PANE_WIDTH_STORAGE_KEY, width, Schema.Number);
    } catch (error) {
      console.warn("Failed to persist file explorer tree width.", error);
    }
  }, []);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startWidth: treePaneWidthRef.current,
      startX: event.clientX,
    };
  }, []);

  const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const containerWidth = splitContainerRef.current?.clientWidth;
    const nextWidth = clampFileTreePaneWidth(
      resizeState.startWidth + event.clientX - resizeState.startX,
      containerWidth,
    );
    if (nextWidth === treePaneWidthRef.current) return;
    treePaneWidthRef.current = nextWidth;
    setTreePaneWidth(nextWidth);
  }, []);

  const handleResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      persistTreePaneWidth(treePaneWidthRef.current);
    },
    [persistTreePaneWidth],
  );

  const workspaceName = projectCwd ? (projectCwd.split("/").at(-1) ?? "Files") : "Files";

  const headerRow = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{workspaceName}</span>
        {truncated && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">(truncated)</span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Open selected file in editor"
              disabled={!selectedRelativePath}
              onClick={openSelectedFileInEditor}
              size="icon-xs"
              variant="ghost"
            >
              <ExternalLinkIcon className="size-3.5" aria-hidden />
            </Button>
          }
        />
        <TooltipPopup side="bottom" align="end">
          Open in editor
        </TooltipPopup>
      </Tooltip>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread || !projectCwd ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No workspace available.
        </div>
      ) : entriesQuery.isLoading && entriesQuery.data === undefined ? (
        <DiffPanelLoadingState label="Loading files..." />
      ) : treePaths.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No files found.
        </div>
      ) : (
        <div ref={splitContainerRef} className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className="min-h-0 shrink-0 overflow-hidden"
            style={
              {
                width: `${treePaneWidth}px`,
                "--trees-bg-override": "var(--background)",
                "--trees-fg-override": "var(--foreground)",
                "--trees-fg-muted-override": "var(--muted-foreground)",
                "--trees-accent-override": "var(--accent)",
                "--trees-border-color-override": "var(--border)",
                "--trees-selected-bg-override": "var(--accent)",
                "--trees-selected-fg-override": "var(--accent-foreground)",
              } as CSSProperties
            }
          >
            <FileTreeComponent model={model} style={{ height: "100%", display: "block" }} />
          </div>
          <div
            aria-label="Resize file tree"
            role="separator"
            aria-orientation="vertical"
            className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-border"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
          >
            <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col border-l border-border/60">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3">
              <span className="truncate text-xs font-medium">
                {selectedRelativePath ? fileNameOf(selectedRelativePath) : "Preview"}
              </span>
              {filePreviewQuery.data?.state === "text" && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                  {formatBytes(filePreviewQuery.data.sizeBytes)}
                </span>
              )}
            </div>
            <FilePreviewContent
              selectedPath={selectedRelativePath}
              readFile={filePreviewQuery.data}
              isLoading={filePreviewQuery.isLoading}
              error={filePreviewQuery.error}
            />
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
