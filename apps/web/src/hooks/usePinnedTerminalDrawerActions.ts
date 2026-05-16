import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { useTerminalStateStore } from "../terminalStateStore";

/**
 * Coordinates server-side PTY session lifecycle around pin/unpin operations.
 *
 * Each action closes the relevant server sessions first, then updates the
 * store. TerminalViewport mounts/remounts with the updated threadId and opens
 * fresh sessions automatically — no explicit open call is needed here.
 *
 * Server cleanup for orphaned pinned sessions (e.g. on crash) relies on the
 * server's inactive-session eviction limit (128 sessions by default). A
 * server-side environment-disconnect cleanup is tracked separately.
 */
export function usePinnedTerminalDrawerActions() {
  const storePinTerminalDrawer = useTerminalStateStore((state) => state.pinTerminalDrawer);
  const storeUnpinTerminalDrawer = useTerminalStateStore((state) => state.unpinTerminalDrawer);
  const storeClosePinnedTerminal = useTerminalStateStore((state) => state.closePinnedTerminal);

  /**
   * Promote a thread's terminal drawer to pinned scope.
   *
   * Closes all sessions under the real thread ID on the server, then writes
   * the pinned state to the store. TerminalViewport remounts with the
   * `pinnedSessionThreadId` and opens fresh sessions with project-root CWD.
   */
  const pinDrawer = useCallback(
    async (threadRef: ScopedThreadRef, logicalProjectKey: string): Promise<void> => {
      const api = readEnvironmentApi(threadRef.environmentId);
      if (api) {
        // Batch-close all sessions for the thread. Errors are non-fatal —
        // the server evicts stale sessions via the inactive-session limit.
        await api.terminal.close({ threadId: threadRef.threadId }).catch(() => undefined);
      }
      storePinTerminalDrawer(threadRef, logicalProjectKey);
    },
    [storePinTerminalDrawer],
  );

  /**
   * Demote a pinned drawer back to per-thread scope.
   *
   * Closes all sessions under the synthetic pinned thread ID, then adopts
   * the pinned layout into the current thread's store state. TerminalViewport
   * remounts with the real `threadRef` and opens fresh sessions.
   */
  const unpinDrawer = useCallback(
    async (
      logicalProjectKey: string,
      environmentId: EnvironmentId,
      pinnedSessionThreadId: string,
      threadRef: ScopedThreadRef,
    ): Promise<void> => {
      const api = readEnvironmentApi(environmentId);
      if (api) {
        await api.terminal
          .close({ threadId: pinnedSessionThreadId, deleteHistory: true })
          .catch(() => undefined);
      }
      storeUnpinTerminalDrawer(logicalProjectKey, environmentId, threadRef);
    },
    [storeUnpinTerminalDrawer],
  );

  /**
   * Close a single terminal in the pinned drawer.
   *
   * When it is the last terminal, closes all server sessions for the pinned
   * thread ID at once and tears down the pinned drawer entirely. Otherwise
   * closes only the specified session.
   */
  const closePinnedTerminal = useCallback(
    async (
      logicalProjectKey: string,
      environmentId: EnvironmentId,
      terminalId: string,
      pinnedSessionThreadId: string,
      isLast: boolean,
    ): Promise<void> => {
      const api = readEnvironmentApi(environmentId);
      if (api) {
        if (isLast) {
          await api.terminal
            .close({ threadId: pinnedSessionThreadId, deleteHistory: true })
            .catch(() => undefined);
        } else {
          await api.terminal
            .close({ threadId: pinnedSessionThreadId, terminalId, deleteHistory: true })
            .catch(() => undefined);
        }
      }
      storeClosePinnedTerminal(logicalProjectKey, environmentId, terminalId);
    },
    [storeClosePinnedTerminal],
  );

  return { pinDrawer, unpinDrawer, closePinnedTerminal };
}
