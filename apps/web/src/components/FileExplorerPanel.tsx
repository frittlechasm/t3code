import { FileTree as FileTreeComponent, useFileTree } from "@pierre/trees/react";
import type { FileTreeSortEntry } from "@pierre/trees";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { ProjectEntry } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { projectListEntriesQueryOptions } from "~/lib/projectReactQuery";
import { openInPreferredEditor } from "../editorPreferences";
import { readLocalApi } from "../localApi";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolvePathLinkTarget } from "../terminal-links";
import { resolveThreadRouteRef } from "../threadRoutes";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";

type FileExplorerPanelMode = DiffPanelMode;

const EMPTY_PROJECT_ENTRIES: readonly ProjectEntry[] = [];

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
  return new Map(
    entries.map((entry) => [entry.kind === "directory" ? `${entry.path}/` : entry.path, entry]),
  );
}

interface FileExplorerPanelProps {
  mode?: FileExplorerPanelMode;
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

  const entriesQuery = useQuery(projectListEntriesQueryOptions({ environmentId, cwd: projectCwd }));
  const entries = entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;

  const treePaths = useMemo(() => toTreePaths(entries), [entries]);
  const entriesByTreePath = useMemo(() => indexEntriesByTreePath(entries), [entries]);
  const truncated = entriesQuery.data?.truncated ?? false;
  const projectCwdRef = useRef<string | null>(projectCwd);
  const entriesByTreePathRef = useRef<ReadonlyMap<string, ProjectEntry>>(entriesByTreePath);
  projectCwdRef.current = projectCwd;
  entriesByTreePathRef.current = entriesByTreePath;

  const { model } = useFileTree({
    paths: treePaths,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: true,
    sort: directoriesFirstSort,
    dragAndDrop: false,
    renaming: false,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1);
      const cwd = projectCwdRef.current;
      if (!selectedPath || !cwd) return;
      const entry = entriesByTreePathRef.current.get(selectedPath);
      if (entry?.kind !== "file") return;
      const api = readLocalApi();
      if (!api) return;
      const targetPath = resolvePathLinkTarget(entry.path, cwd);
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open file explorer entry in editor.", error);
      });
    },
  });

  useEffect(() => {
    model.resetPaths(treePaths);
  }, [model, treePaths]);

  const workspaceName = projectCwd ? (projectCwd.split("/").at(-1) ?? "Files") : "Files";

  const headerRow = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-medium">{workspaceName}</span>
      {truncated && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">(truncated)</span>
      )}
    </div>
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
        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={
            {
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
      )}
    </DiffPanelShell>
  );
}
