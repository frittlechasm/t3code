# Patch Summary

## Terminal Font Configuration

This patch adds a configurable font family for the integrated terminal.

### What changed

- Added `terminalFontFamily` to client settings with a shared default:
  - `packages/contracts/src/settings.ts`
- Added schema coverage for terminal font defaults and trimming:
  - `packages/contracts/src/settings.test.ts`
- Wired the terminal drawer to read the configured font from settings:
  - `apps/web/src/components/ThreadTerminalDrawer.tsx`
- Updated the terminal font live, without recreating the xterm instance:
  - Applies `terminal.options.fontFamily`
  - Refits the terminal
  - Resizes the backend PTY
  - Preserves scroll-to-bottom behavior when applicable
- Added a General Settings row for editing and resetting the terminal font:
  - `apps/web/src/components/settings/SettingsPanels.tsx`
- Included `terminalFontFamily` in settings restore/reset logic:
  - `apps/web/src/components/settings/SettingsPanels.tsx`
- Updated desktop and web tests that construct complete client settings:
  - `apps/desktop/src/settings/DesktopClientSettings.test.ts`
  - `apps/web/src/localApi.test.ts`

### Default font stack

```txt
"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace
```

### Recommended Nerd Font value

For terminal file icons, users can put a Nerd Font first:

```txt
"JetBrainsMono Nerd Font Mono", "SF Mono", monospace
```

### Behavior notes

- Empty or whitespace-only font input falls back to the default terminal font stack.
- Custom values are trimmed before being stored.
- Changing the font setting updates the active terminal in place instead of tearing down the terminal session.

## File Explorer

This patch adds a right-side file explorer and file preview workflow to chat sessions. It lets users browse the active project tree, open files in tabs, preview file contents, inspect per-file git diffs, open files in the preferred editor, and keep the explorer usable through keyboard shortcuts and desktop window-close behavior.

### Major changes

- Added project file APIs across contracts, server, and web runtime:
  - `projects.listEntries` returns the workspace file/directory tree.
  - `projects.readFile` returns discriminated file preview states: `text`, `binary`, `too_large`, and `missing`.
  - The web environment API and websocket RPC client expose these methods to React Query.
- Added workspace filesystem support on the server:
  - File reads resolve relative paths through `WorkspacePaths.resolveRelativePathWithinRoot`.
  - Symlink/realpath checks reject reads that escape the workspace root.
  - Reads are size-limited and detect binary or invalid UTF-8 content before returning text.
  - Workspace entry caches are invalidated after writes so explorer data does not remain stale.
- Added git file-diff support:
  - `GitVcsDriverCore` can produce bounded per-file patches for explorer previews.
  - Diff rendering reuses the existing diff rendering path and falls back to raw text when structured patch parsing cannot render safely.
  - Git status is projected into file tree entries so changed files can be visually marked.
  - Bounded diff commands use the existing `appendTruncationMarker` execution option so oversized output is reported through `stdoutTruncated` instead of failing typecheck on a stale option name.
- Added the `FileExplorerPanel` UI:
  - Uses `@pierre/trees` for the file tree and `@pierre/diffs` for file/diff previews.
  - Supports a resizable tree pane, persisted tree visibility, content vs changes modes, line wrapping, loading/error/empty states, and editor-open actions.
  - Keeps preview tabs in `fileExplorerTabs.ts`, including open, close, next/previous navigation, and active-tab selection after close.
- Added right-panel layout integration:
  - `RightPanelInlineSidebar` hosts right-side panels without coupling the explorer directly to the chat route layout.
  - Chat route search state now carries right-panel mode and selected file path data.
  - Draft threads can open the explorer by resolving the project context from composer draft state when no persisted thread exists yet.
- Added keyboard and desktop integration:
  - New shared keybinding command for toggling the file tree.
  - File explorer search focus, tree toggle, tab navigation, and close-tab handling are wired in the web UI.
  - The file explorer toggle is allowed while terminal focus is active, including migration for the older shortcut shape.
  - Desktop IPC exposes window close requests so the explorer can intercept close behavior and restore focus predictably.

### Architectural context for syncing

- Keep `packages/contracts` schema-only. This branch adds schemas and tagged errors for project file operations, but runtime behavior lives in `apps/server` and `apps/web`.
- The server-side project file boundary is `WorkspaceFileSystem` and `WorkspaceEntries`. Preserve the root-resolution and realpath escape checks when rebasing; do not replace them with client-side path filtering.
- `readFile` intentionally returns preview states instead of only throwing errors. Merge code should preserve the discriminated union because the UI relies on it for binary, too-large, and missing-file states.
- `FileExplorerPanel` is large but mostly UI orchestration. Pure tab behavior is extracted into `apps/web/src/fileExplorerTabs.ts`; keep future tab logic there to avoid growing component-local state rules.
- The right panel is route/search-state driven. When merging with other right-side panel work, reconcile `diffRouteSearch.ts`, `_chat.$environmentId.$threadId.tsx`, and `ChatView.tsx` together.
- Git diff support is bounded by output limits in `GitVcsDriverCore`. If upstream changed git command limits or truncation behavior, keep per-file diff output capped to avoid freezing the UI on huge patches.
- Desktop close handling flows through the IPC/window contract. Preserve the request/event boundary so web UI can decide whether to consume a close request before the native window closes.
- The branch adds `@pierre/trees` to the web package. If upstream dependency layout changes, ensure `apps/web/package.json` and `bun.lock` stay in sync.

## Task Window Toggle

This branch adds a task window shortcut that opens and closes the existing chat plan/tasks sidebar with `Mod+Shift+T`. It keeps the diff panel route state scoped to diff-only behavior so task activity continues to use the task UI that already exists in `ChatView`.

### Major changes

- Kept diff route state diff-only:
  - `diffRouteSearch.ts` supports `panel=diff` and the file explorer's `panel=files`.
  - Legacy `diff=1` remains supported as a compatibility alias for the diff panel.
  - Diff-specific params are only retained when the diff panel is actually open.
  - `panel=tasks` is ignored so stale URLs cannot open a second task surface.
- Added task window keybinding:
  - `taskWindow.toggle` was added to the contracts command list.
  - The shared default keybinding maps it to `mod+shift+t` outside terminal focus.
  - Web keybinding helpers and `ChatView` toggle the existing plan/tasks sidebar.

### Reasons for the changes

- Task lifecycle and plan step activity already render in the existing chat sidebar, but there was no direct task-window shortcut for opening and closing it.
- Reusing the existing sidebar avoids creating a second task window and keeps task inspection in the same surface as the composer task toggle.
- Preserving `diff=1` avoids breaking existing diff links and navigation state.
- The task window shortcut is optimized for keyboard-heavy operator workflows.

### Architectural context for syncing

- `diffRouteSearch.ts` remains responsible for diff panel route state and `diff=1` compatibility. Do not reintroduce `panel=tasks` unless the existing chat task sidebar is intentionally replaced.
- The task window uses `ChatView`'s `planSidebarOpen` state and `PlanSidebar` rendering path.
- `taskWindow.toggle` is part of the shared keybinding contract. Keep contracts, shared defaults, web matching, and settings labels in sync when resolving keybinding conflicts.
- The default shortcut excludes terminal focus through the shared `when: "!terminalFocus"` condition. Keep that guard unless terminal key handling is explicitly made right-panel aware.

## Terminal Tab Navigation

This patch expands terminal UX and state management with terminal tab/group navigation, nested split layouts, split focus navigation, configurable terminal view mode, bottom-vs-right placement, and pinned terminal drawer support.

### Major changes

- Added terminal domain docs and glossary entries in `CONTEXT.md`, `docs/terminal-placement.md`, `docs/terminal-splits.md`, and `docs/pinned-terminals.md`.
- Expanded terminal state from one active terminal into grouped state with terminal ids, groups, active terminal/group ids, running subprocess ids, split layouts, placement, and logical-project dimensions.
- Added nested terminal split layout helpers for vertical and horizontal splits, anchor-specific insertion, pruning, normalization, and split focus resolution.
- Updated `ThreadTerminalDrawer` to derive layout centrally, render tabs/sidebar modes, render recursive split layouts, and expose toolbar actions for placement, vertical/horizontal split, tab switching, split focus, pinning, and closing.
- Added terminal settings for `defaultTerminalPlacement` and `terminalViewMode`, while preserving configurable `terminalFontFamily`.
- Added terminal keybinding commands for placement toggle, horizontal split, tab previous/next, tab jumps, split focus, and pinned drawer actions across contracts, shared defaults, server, and web.

### Architectural context for syncing

- Preserve the distinction between Terminal placement (`bottom` vs `right`), Terminal view mode (`tabs` vs `sidebar`), and Terminal split orientation (`vertical` vs `horizontal` inside split layouts).
- `ChatView` owns effective placement and may render bottom placement on narrow screens without mutating the saved right-placement preference.
- `ThreadTerminalDrawer` layout derivation belongs in `resolveThreadTerminalDrawerLayout` so UI rendering and tests stay aligned.
- Terminal keybinding commands must stay synchronized across `packages/contracts`, `packages/shared`, `apps/server`, and `apps/web`.
