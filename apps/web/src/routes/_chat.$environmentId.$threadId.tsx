import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  getOpenRightPanel,
  isDiffPanelOpen,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelInlineSidebar } from "../components/RightPanelInlineSidebar";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { SidebarInset } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const FileExplorerPanel = lazy(() => import("../components/FileExplorerPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const DIFF_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;

const FILE_EXPLORER_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_file_explorer_sidebar_width";
const FILE_EXPLORER_INLINE_DEFAULT_WIDTH = "clamp(16rem,22vw,26rem)";
const FILE_EXPLORER_INLINE_SIDEBAR_MIN_WIDTH = 14 * 16;
const FILE_EXPLORER_INLINE_SIDEBAR_MAX_WIDTH = 64 * 16;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const LazyFileExplorerPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <Suspense fallback={<DiffPanelLoadingState label="Loading file explorer..." />}>
      <FileExplorerPanel mode={props.mode} />
    </Suspense>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );

  return (
    <RightPanelInlineSidebar
      open={diffOpen}
      onOpenChange={onOpenChange}
      defaultWidth={DIFF_INLINE_DEFAULT_WIDTH}
      maxWidth={DIFF_INLINE_SIDEBAR_MAX_WIDTH}
      minWidth={DIFF_INLINE_SIDEBAR_MIN_WIDTH}
      storageKey={DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY}
    >
      {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
    </RightPanelInlineSidebar>
  );
};

const FileExplorerPanelInlineSidebar = (props: {
  filesOpen: boolean;
  onCloseFiles: () => void;
  onOpenFiles: () => void;
  renderFilesContent: boolean;
}) => {
  const { filesOpen, onCloseFiles, onOpenFiles, renderFilesContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenFiles();
        return;
      }
      onCloseFiles();
    },
    [onCloseFiles, onOpenFiles],
  );

  return (
    <RightPanelInlineSidebar
      open={filesOpen}
      onOpenChange={onOpenChange}
      defaultWidth={FILE_EXPLORER_INLINE_DEFAULT_WIDTH}
      maxWidth={FILE_EXPLORER_INLINE_SIDEBAR_MAX_WIDTH}
      minWidth={FILE_EXPLORER_INLINE_SIDEBAR_MIN_WIDTH}
      storageKey={FILE_EXPLORER_INLINE_SIDEBAR_WIDTH_STORAGE_KEY}
    >
      {renderFilesContent ? <LazyFileExplorerPanel mode="sidebar" /> : null}
    </RightPanelInlineSidebar>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const openPanel = getOpenRightPanel(search);
  const diffOpen = isDiffPanelOpen(search);
  const filesOpen = openPanel === "files";
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;

  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);

  const [fileExplorerMountState, setFileExplorerMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedFiles: filesOpen,
  }));
  const hasOpenedFiles =
    fileExplorerMountState.threadKey === currentThreadKey
      ? fileExplorerMountState.hasOpenedFiles
      : filesOpen;
  const markFilesOpened = useCallback(() => {
    setFileExplorerMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedFiles) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedFiles: true,
      };
    });
  }, [currentThreadKey]);

  const closeDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { panel: undefined, diff: undefined, diffTurnId: undefined, diffFilePath: undefined },
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, panel: "diff" };
      },
    });
  }, [markDiffOpened, navigate, threadRef]);

  const closeFiles = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { panel: undefined, diff: undefined, diffTurnId: undefined, diffFilePath: undefined },
    });
  }, [navigate, threadRef]);
  const openFiles = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markFilesOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, panel: "files" };
      },
    });
  }, [markFilesOpened, navigate, threadRef]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const shouldRenderFilesContent = filesOpen || hasOpenedFiles;
  const anyPanelOpen = diffOpen || filesOpen;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markDiffOpened}
            onFileExplorerPanelOpen={markFilesOpened}
            reserveTitleBarControlInset={!anyPanelOpen}
            routeKind="server"
          />
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
        <FileExplorerPanelInlineSidebar
          filesOpen={filesOpen}
          onCloseFiles={closeFiles}
          onOpenFiles={openFiles}
          renderFilesContent={shouldRenderFilesContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          onFileExplorerPanelOpen={markFilesOpened}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </RightPanelSheet>
      <RightPanelSheet open={filesOpen} onClose={closeFiles}>
        {shouldRenderFilesContent ? <LazyFileExplorerPanel mode="sheet" /> : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["panel", "diff"])],
  },
  component: ChatThreadRouteView,
});
