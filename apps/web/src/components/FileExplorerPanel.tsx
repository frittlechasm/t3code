import { FileTree as FileTreeComponent, useFileTree } from "@pierre/trees/react";
import type { FileTreeSortEntry, GitStatusEntry } from "@pierre/trees";
import { parsePatchFiles } from "@pierre/diffs";
import { File, FileDiff, type FileContents, type FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";
import type {
  ProjectEntry,
  ProjectReadFileResult,
  VcsFileDiffResult,
  VcsStatusResult,
} from "@t3tools/contracts";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import * as Schema from "effect/Schema";
import {
  Code2Icon,
  ExternalLinkIcon,
  GitCompareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  TextWrapIcon,
  XIcon,
} from "lucide-react";
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
import { useSettings } from "~/hooks/useSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  closeFileExplorerTab,
  fileExplorerTabDirectionFromShortcut,
  isFileExplorerCloseTabShortcut,
  openFileExplorerTab,
  selectAdjacentFileExplorerTab,
} from "~/fileExplorerTabs";
import { useServerKeybindings } from "~/rpc/serverState";
import {
  isFileExplorerFocusSearchShortcut,
  isFileExplorerToggleTreeShortcut,
  isOpenFavoriteEditorShortcut,
  shortcutLabelForCommand,
} from "../keybindings";
import { useTheme } from "~/hooks/useTheme";
import {
  DIFF_RENDER_UNSAFE_CSS,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { vcsFileDiffQueryOptions } from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import {
  projectListEntriesQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { openInPreferredEditor } from "../editorPreferences";
import { readLocalApi } from "../localApi";
import { cn, isMacPlatform } from "../lib/utils";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolvePathLinkTarget } from "../terminal-links";
import { resolveThreadRouteRef } from "../threadRoutes";
import { WINDOW_CLOSE_REQUEST_EVENT } from "../windowCloseRequests";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

type FileExplorerPanelMode = DiffPanelMode;

const EMPTY_PROJECT_ENTRIES: readonly ProjectEntry[] = [];
const EMPTY_GIT_STATUS_ENTRIES: readonly GitStatusEntry[] = [];
const FILE_EXPLORER_DIFF_CONTEXT_LINES = 8;
const FILE_TREE_PANE_WIDTH_STORAGE_KEY = "chat_file_explorer_tree_width";
const FILE_TREE_PANE_VISIBLE_STORAGE_KEY = "chat_file_explorer_tree_visible";
const FILE_TREE_PANE_DEFAULT_WIDTH = 220;
const FILE_TREE_PANE_MIN_WIDTH = 180;
const FILE_TREE_PANE_MAX_WIDTH = 420;
const FILE_PREVIEW_MIN_WIDTH = 220;

type FilePreviewMode = "contents" | "changes";
type DiffThemeType = "light" | "dark";

type RenderableFileDiff =
  | { kind: "file"; fileDiff: FileDiffMetadata }
  | { kind: "raw"; text: string; reason: string };

function isTextInputFocusTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

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

function readPersistedFileTreePaneVisible(): boolean {
  try {
    return getLocalStorageItem(FILE_TREE_PANE_VISIBLE_STORAGE_KEY, Schema.Boolean) ?? true;
  } catch (error) {
    console.warn("Failed to read persisted file explorer tree visibility.", error);
    return true;
  }
}

function isDefaultFileExplorerToggleTreeShortcut(event: KeyboardEvent): boolean {
  const useMetaForMod = isMacPlatform(navigator.platform);
  const expectedMeta = useMetaForMod;
  const expectedCtrl = !useMetaForMod;
  return (
    event.key.toLowerCase() === "y" &&
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey &&
    !event.altKey
  );
}

function defaultFileExplorerToggleTreeShortcutLabel(): string {
  return isMacPlatform(navigator.platform) ? "\u21e7\u2318Y" : "Ctrl+Shift+Y";
}

function resolveToggleTreeShortcutLabel(label: string | null): string {
  if (label === "\u2325\u2318E" || label === "Ctrl+Alt+E") {
    return defaultFileExplorerToggleTreeShortcutLabel();
  }
  return label ?? defaultFileExplorerToggleTreeShortcutLabel();
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

function isPathChanged(status: VcsStatusResult | null, path: string | null): boolean {
  if (!path || !status?.isRepo) return false;
  return status.workingTree.files.some((file) => file.path === path);
}

function getRenderableFileDiff(
  patch: string | undefined,
  cacheScope: string,
): RenderableFileDiff | null {
  if (!patch || patch.trim().length === 0) return null;
  const normalizedPatch = patch.trim();

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const fileDiff = parsedPatches.flatMap((parsedPatch) => parsedPatch.files).at(0);
    if (fileDiff) {
      return { kind: "file", fileDiff };
    }
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function buildPreviewFileContents(path: string, readFile: ProjectReadFileResult): FileContents {
  return {
    name: path,
    contents: readFile.state === "text" ? readFile.contents : "",
    cacheKey:
      readFile.state === "text"
        ? `file-preview:${path}:${readFile.sizeBytes}:${readFile.contents.length}`
        : `file-preview:${path}:empty`,
  };
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
  compactFileDiff: VcsFileDiffResult | undefined;
  fullFileDiff: VcsFileDiffResult | undefined;
  previewMode: FilePreviewMode;
  isLoading: boolean;
  isCompactDiffLoading: boolean;
  error: unknown;
  compactDiffError: unknown;
  diffWordWrap: boolean;
  resolvedTheme: "light" | "dark";
  emptySelectionMessage?: string;
}) {
  if (!props.selectedPath) {
    return (
      <FilePreviewState>
        {props.emptySelectionMessage ?? "Select a file to preview."}
      </FilePreviewState>
    );
  }

  if (props.previewMode === "changes") {
    if (props.isCompactDiffLoading && props.compactFileDiff === undefined) {
      return <FilePreviewState>Loading changes...</FilePreviewState>;
    }

    if (props.compactDiffError) {
      return <FilePreviewState>Unable to load changes.</FilePreviewState>;
    }

    const fileDiff = props.compactFileDiff;
    if (!fileDiff || fileDiff.state === "empty") {
      return <FilePreviewState>No working-tree changes for this file.</FilePreviewState>;
    }

    if (fileDiff.state === "too_large") {
      return (
        <FilePreviewState>
          Changes are too large to preview ({formatBytes(fileDiff.sizeBytes)}; limit{" "}
          {formatBytes(fileDiff.maxBytes)}).
        </FilePreviewState>
      );
    }

    const renderableDiff = getRenderableFileDiff(
      fileDiff.patch,
      `file-explorer-changes:${props.resolvedTheme}`,
    );
    if (!renderableDiff) {
      return <FilePreviewState>No working-tree changes for this file.</FilePreviewState>;
    }

    if (renderableDiff.kind === "raw") {
      return (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <p className="mb-2 text-[11px] text-muted-foreground/75">{renderableDiff.reason}</p>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
            {renderableDiff.text}
          </pre>
        </div>
      );
    }

    return (
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <FileDiff
          fileDiff={renderableDiff.fileDiff}
          options={{
            disableFileHeader: true,
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: props.diffWordWrap ? "wrap" : "scroll",
            theme: resolveDiffThemeName(props.resolvedTheme),
            themeType: props.resolvedTheme as DiffThemeType,
            unsafeCSS: DIFF_RENDER_UNSAFE_CSS,
          }}
        />
      </div>
    );
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

  if (props.fullFileDiff?.state === "patch") {
    const renderableDiff = getRenderableFileDiff(
      props.fullFileDiff.patch,
      `file-explorer-full:${props.resolvedTheme}`,
    );
    if (renderableDiff?.kind === "file") {
      return (
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          <FileDiff
            fileDiff={renderableDiff.fileDiff}
            options={{
              disableFileHeader: true,
              diffStyle: "unified",
              lineDiffType: "none",
              expandUnchanged: true,
              overflow: props.diffWordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(props.resolvedTheme),
              themeType: props.resolvedTheme as DiffThemeType,
              unsafeCSS: DIFF_RENDER_UNSAFE_CSS,
            }}
          />
        </div>
      );
    }
  }

  const previewFile = buildPreviewFileContents(props.selectedPath, readFile);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
      <File
        file={previewFile}
        options={{
          disableFileHeader: true,
          overflow: props.diffWordWrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(props.resolvedTheme),
          themeType: props.resolvedTheme as DiffThemeType,
          unsafeCSS: DIFF_RENDER_UNSAFE_CSS,
        }}
      />
    </div>
  );
}

export default function FileExplorerPanel({ mode = "inline" }: FileExplorerPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const draftThread = useComposerDraftStore((store) =>
    routeThreadRef ? store.getDraftSessionByRef(routeThreadRef) : null,
  );
  const threadContext = activeThread ?? draftThread;
  const projectRef = threadContext
    ? scopeProjectRef(threadContext.environmentId, threadContext.projectId)
    : null;
  const activeProject = useStore((store) =>
    projectRef ? selectProjectByRef(store, projectRef) : undefined,
  );

  const environmentId = threadContext?.environmentId ?? null;
  const projectCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: threadContext?.worktreePath ?? null,
      })
    : null;
  const [openFileTabs, setOpenFileTabs] = useState<readonly string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<FilePreviewMode>("contents");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [treePaneWidth, setTreePaneWidth] = useState(readPersistedFileTreePaneWidth);
  const [treePaneVisible, setTreePaneVisible] = useState(readPersistedFileTreePaneVisible);

  const entriesQuery = useQuery(projectListEntriesQueryOptions({ environmentId, cwd: projectCwd }));
  const entries = entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const gitStatus = useGitStatus({ environmentId, cwd: projectCwd });
  const filePreviewQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId,
      cwd: projectCwd,
      relativePath: activeFilePath,
    }),
  );
  const selectedFileHasChanges = isPathChanged(gitStatus.data, activeFilePath);
  const compactFileDiffQuery = useQuery(
    vcsFileDiffQueryOptions({
      environmentId,
      cwd: projectCwd,
      path: activeFilePath,
      ignoreWhitespace: settings.diffIgnoreWhitespace,
      contextLines: FILE_EXPLORER_DIFF_CONTEXT_LINES,
      enabled: selectedFileHasChanges,
    }),
  );
  const fullFileDiffQuery = useQuery(
    vcsFileDiffQueryOptions({
      environmentId,
      cwd: projectCwd,
      path: activeFilePath,
      ignoreWhitespace: settings.diffIgnoreWhitespace,
      enabled: selectedFileHasChanges,
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
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const lastPreviewKeyboardCloseAtRef = useRef(0);
  const treePaneWidthRef = useRef(treePaneWidth);
  const resizeStateRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const projectCwdRef = useRef<string | null>(projectCwd);
  const entriesByTreePathRef = useRef<ReadonlyMap<string, ProjectEntry>>(entriesByTreePath);
  const activeFilePathRef = useRef<string | null>(activeFilePath);
  const openFileTabsRef = useRef<readonly string[]>(openFileTabs);
  projectCwdRef.current = projectCwd;
  entriesByTreePathRef.current = entriesByTreePath;
  activeFilePathRef.current = activeFilePath;
  openFileTabsRef.current = openFileTabs;
  treePaneWidthRef.current = treePaneWidth;

  const focusPreviewPaneSoon = useCallback((options?: { preserveTextInputFocus?: boolean }) => {
    window.requestAnimationFrame(() => {
      if (options?.preserveTextInputFocus && isTextInputFocusTarget(document.activeElement)) {
        return;
      }
      previewPaneRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const openSelectedFileInEditor = useCallback(() => {
    const cwd = projectCwdRef.current;
    const relativePath = activeFilePath;
    if (!cwd || !relativePath) return;
    const api = readLocalApi();
    if (!api) return;
    const filePath = resolvePathLinkTarget(relativePath, cwd);
    void openInPreferredEditor(api, cwd, filePath).catch((error) => {
      console.warn("Failed to open file explorer entry in editor.", error);
    });
  }, [activeFilePath]);

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
        return;
      }
      const entry = entriesByTreePathRef.current.get(selectedPath);
      if (entry?.kind !== "file") return;
      const next = openFileExplorerTab(openFileTabsRef.current, entry.path);
      setOpenFileTabs(next.tabs);
      setActiveFilePath(next.activePath);
      focusPreviewPaneSoon({ preserveTextInputFocus: true });
    },
  });

  useEffect(() => {
    model.resetPaths(treePaths);
  }, [model, treePaths]);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(() => {
    setPreviewMode(selectedFileHasChanges ? "changes" : "contents");
  }, [selectedFileHasChanges, activeFilePath]);

  useEffect(() => {
    setOpenFileTabs([]);
    setActiveFilePath(null);
  }, [projectCwd]);

  const keybindings = useServerKeybindings();
  const toggleTreeShortcutLabel = useMemo(() => {
    const label = shortcutLabelForCommand(keybindings, "fileExplorer.toggleTree", {
      context: { terminalFocus: false },
    });
    return resolveToggleTreeShortcutLabel(label);
  }, [keybindings]);
  const isFilesPanelOpen = useSearch({
    strict: false,
    select: (search) => (search as { panel?: string }).panel === "files",
  });
  const previousFilesPanelOpenRef = useRef(false);

  useEffect(() => {
    if (isFilesPanelOpen && !previousFilesPanelOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
    }
    previousFilesPanelOpenRef.current = isFilesPanelOpen;
  }, [isFilesPanelOpen, settings.diffWordWrap]);

  useEffect(() => {
    if (!isFilesPanelOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      const relativePath = activeFilePathRef.current;
      const cwd = projectCwdRef.current;
      if (!relativePath || !cwd) return;

      const api = readLocalApi();
      if (!api) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const filePath = resolvePathLinkTarget(relativePath, cwd);
      void openInPreferredEditor(api, cwd, filePath).catch((error) => {
        console.warn("Failed to open previewed file in editor.", error);
      });
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isFilesPanelOpen, keybindings]);

  useEffect(() => {
    if (!isFilesPanelOpen) return;

    const handler = (e: KeyboardEvent) => {
      const direction = fileExplorerTabDirectionFromShortcut(e);
      if (!direction) return;

      const nextActivePath = selectAdjacentFileExplorerTab(
        openFileTabsRef.current,
        activeFilePathRef.current,
        direction,
      );
      if (!nextActivePath || nextActivePath === activeFilePathRef.current) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      setActiveFilePath(nextActivePath);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isFilesPanelOpen]);

  useEffect(() => {
    if (!isFilesPanelOpen) return;

    const closeActivePreviewTab = (): boolean => {
      const activeElement = document.activeElement;
      const previewPane = previewPaneRef.current;
      if (
        !previewPane ||
        !(activeElement instanceof Node) ||
        !previewPane.contains(activeElement)
      ) {
        return false;
      }

      const activePath = activeFilePathRef.current;
      if (!activePath) return false;

      const next = closeFileExplorerTab(openFileTabsRef.current, activePath, activePath);
      setOpenFileTabs(next.tabs);
      setActiveFilePath(next.activePath);
      focusPreviewPaneSoon();
      return true;
    };

    const handler = (e: KeyboardEvent) => {
      if (!isFileExplorerCloseTabShortcut(e)) return;
      if (!closeActivePreviewTab()) return;

      lastPreviewKeyboardCloseAtRef.current = performance.now();
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const closeRequestHandler = (event: Event) => {
      if (performance.now() - lastPreviewKeyboardCloseAtRef.current < 250) {
        event.preventDefault();
        return;
      }
      if (!closeActivePreviewTab()) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", handler, true);
    window.addEventListener(WINDOW_CLOSE_REQUEST_EVENT, closeRequestHandler);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener(WINDOW_CLOSE_REQUEST_EVENT, closeRequestHandler);
    };
  }, [focusPreviewPaneSoon, isFilesPanelOpen]);

  useEffect(() => {
    if (!isFilesPanelOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (
        isFileExplorerToggleTreeShortcut(e, keybindings) ||
        isDefaultFileExplorerToggleTreeShortcut(e)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setTreePaneVisible((visible) => {
          const nextVisible = !visible;
          try {
            setLocalStorageItem(FILE_TREE_PANE_VISIBLE_STORAGE_KEY, nextVisible, Schema.Boolean);
          } catch (error) {
            console.warn("Failed to persist file explorer tree visibility.", error);
          }
          return nextVisible;
        });
        return;
      }

      if (!isFileExplorerFocusSearchShortcut(e, keybindings)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setTreePaneVisible(true);
      try {
        setLocalStorageItem(FILE_TREE_PANE_VISIBLE_STORAGE_KEY, true, Schema.Boolean);
      } catch (error) {
        console.warn("Failed to persist file explorer tree visibility.", error);
      }
      if (!model.isSearchOpen()) {
        model.openSearch();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isFilesPanelOpen, keybindings, model]);

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

  const persistTreePaneVisible = useCallback((visible: boolean) => {
    try {
      setLocalStorageItem(FILE_TREE_PANE_VISIBLE_STORAGE_KEY, visible, Schema.Boolean);
    } catch (error) {
      console.warn("Failed to persist file explorer tree visibility.", error);
    }
  }, []);

  const handleToggleTreePane = useCallback(() => {
    setTreePaneVisible((visible) => {
      const nextVisible = !visible;
      persistTreePaneVisible(nextVisible);
      return nextVisible;
    });
  }, [persistTreePaneVisible]);

  const handleCloseFileTab = useCallback(
    (path: string) => {
      const next = closeFileExplorerTab(openFileTabsRef.current, activeFilePathRef.current, path);
      setOpenFileTabs(next.tabs);
      setActiveFilePath(next.activePath);
      focusPreviewPaneSoon();
    },
    [focusPreviewPaneSoon],
  );

  const handleSelectFileTab = useCallback(
    (path: string) => {
      setActiveFilePath(path);
      focusPreviewPaneSoon();
    },
    [focusPreviewPaneSoon],
  );

  const handlePreviewPanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button, input, textarea, select, [contenteditable='true'], a[href]")
    ) {
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
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
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Open selected file in editor"
                disabled={!activeFilePath}
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={treePaneVisible ? "Hide file tree" : "Show file tree"}
                aria-pressed={treePaneVisible}
                onClick={handleToggleTreePane}
                size="icon-xs"
                variant="ghost"
              >
                {treePaneVisible ? (
                  <PanelLeftCloseIcon className="size-3.5" aria-hidden />
                ) : (
                  <PanelLeftOpenIcon className="size-3.5" aria-hidden />
                )}
              </Button>
            }
          />
          <TooltipPopup side="bottom" align="end">
            {treePaneVisible ? "Hide file tree" : "Show file tree"}
            {toggleTreeShortcutLabel ? ` (${toggleTreeShortcutLabel})` : ""}
          </TooltipPopup>
        </Tooltip>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!threadContext || !projectCwd ? (
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
          {treePaneVisible ? (
            <>
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
            </>
          ) : null}
          <div
            ref={previewPaneRef}
            tabIndex={0}
            aria-label="File preview"
            onPointerDown={handlePreviewPanePointerDown}
            className={
              treePaneVisible
                ? "flex min-w-0 flex-1 flex-col border-l border-border/60 outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
                : "flex min-w-0 flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
            }
          >
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
              <div
                className="flex min-w-0 flex-1 items-end self-stretch overflow-x-auto"
                role="tablist"
                aria-label="Open files"
              >
                {openFileTabs.length === 0 ? (
                  <span className="self-center truncate px-1 text-xs font-medium text-muted-foreground/80">
                    Preview
                  </span>
                ) : (
                  openFileTabs.map((path) => {
                    const active = path === activeFilePath;
                    return (
                      <div
                        key={path}
                        className={cn(
                          "flex h-8 min-w-0 max-w-48 shrink-0 items-center border-r border-border/50",
                          active
                            ? "bg-background text-foreground"
                            : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                        role="presentation"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          title={path}
                          className="min-w-0 flex-1 truncate px-2 text-left text-xs font-medium"
                          onClick={() => handleSelectFileTab(path)}
                        >
                          {fileNameOf(path)}
                        </button>
                        <button
                          type="button"
                          aria-label={`Close ${fileNameOf(path)}`}
                          className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                          onClick={() => handleCloseFileTab(path)}
                        >
                          <XIcon className="size-3" aria-hidden />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              {activeFilePath && (
                <ToggleGroup
                  className="shrink-0"
                  variant="outline"
                  size="xs"
                  value={[previewMode]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "contents" || next === "changes") {
                      setPreviewMode(next);
                    }
                  }}
                >
                  <Toggle aria-label="Show file contents" value="contents">
                    <Code2Icon className="size-3" />
                  </Toggle>
                  <Toggle
                    aria-label="Show working-tree changes"
                    value="changes"
                    disabled={!selectedFileHasChanges}
                  >
                    <GitCompareIcon className="size-3" />
                  </Toggle>
                </ToggleGroup>
              )}
              {activeFilePath && (
                <Toggle
                  aria-label={diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
                  variant="outline"
                  size="xs"
                  pressed={diffWordWrap}
                  onPressedChange={(pressed) => setDiffWordWrap(Boolean(pressed))}
                >
                  <TextWrapIcon className="size-3" />
                </Toggle>
              )}
              {filePreviewQuery.data?.state === "text" && (
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  {formatBytes(filePreviewQuery.data.sizeBytes)}
                </span>
              )}
            </div>
            <FilePreviewContent
              selectedPath={activeFilePath}
              readFile={filePreviewQuery.data}
              compactFileDiff={compactFileDiffQuery.data}
              fullFileDiff={fullFileDiffQuery.data}
              previewMode={previewMode}
              isLoading={filePreviewQuery.isLoading}
              isCompactDiffLoading={compactFileDiffQuery.isLoading}
              error={filePreviewQuery.error}
              compactDiffError={compactFileDiffQuery.error}
              diffWordWrap={diffWordWrap}
              resolvedTheme={resolvedTheme}
              {...(!treePaneVisible
                ? { emptySelectionMessage: "Show the file tree to select a file." }
                : {})}
            />
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
