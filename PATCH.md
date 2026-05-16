# Patch Summaries

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

### Branch Scope

This branch adds a right-side file explorer and file preview workflow to chat sessions. It lets users browse the active project tree, open files in tabs, preview file contents, inspect per-file git diffs, open files in the preferred editor, and keep the explorer usable through keyboard shortcuts and desktop window-close behavior.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

### Major Changes

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

### Reasons For The Changes

- Users need to inspect project files without leaving the agent session. The explorer keeps project context next to the conversation and terminal.
- File preview must be reliable under large, binary, missing, or symlinked files. The server returns explicit states instead of throwing generic preview failures for expected filesystem conditions.
- The UI needs to scale beyond a single preview. Tabs, content/diff mode, and persistent tree sizing make repeated file inspection predictable.
- Git diffs belong near file browsing because the explorer is often used during merge, review, and agent-generated change inspection.
- Keyboard behavior matters because this app is agent/operator oriented. The explorer shortcuts are integrated into the shared keybinding system so server, web, and desktop labels stay aligned.

### Architectural Context For Syncing

- Keep `packages/contracts` schema-only. This branch adds schemas and tagged errors for project file operations, but runtime behavior lives in `apps/server` and `apps/web`.
- The server-side project file boundary is `WorkspaceFileSystem` and `WorkspaceEntries`. Preserve the root-resolution and realpath escape checks when rebasing; do not replace them with client-side path filtering.
- `readFile` intentionally returns preview states instead of only throwing errors. Merge code should preserve the discriminated union because the UI relies on it for binary, too-large, and missing-file states.
- `FileExplorerPanel` is large but mostly UI orchestration. Pure tab behavior is extracted into `apps/web/src/fileExplorerTabs.ts`; keep future tab logic there to avoid growing component-local state rules.
- The right panel is route/search-state driven. When merging with other right-side panel work, reconcile `diffRouteSearch.ts`, `_chat.$environmentId.$threadId.tsx`, and `ChatView.tsx` together.
- Git diff support is bounded by output limits in `GitVcsDriverCore`. If upstream changed git command limits or truncation behavior, keep per-file diff output capped to avoid freezing the UI on huge patches.
- Desktop close handling flows through the IPC/window contract. Preserve the request/event boundary so web UI can decide whether to consume a close request before the native window closes.
- The branch adds `@pierre/trees` to the web package. If upstream dependency layout changes, ensure `apps/web/package.json` and `bun.lock` stay in sync.

### Files Most Likely To Conflict

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/diffRouteSearch.ts`
- `apps/web/src/keybindings.ts`
- `apps/server/src/keybindings.ts`
- `apps/server/src/vcs/GitVcsDriverCore.ts`
- `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/shared/src/keybindings.ts`

### Verification Added On Branch

- Workspace file listing and read behavior tests, including invalid paths, binary/large files, and missing files.
- Git VCS per-file diff tests.
- Web file explorer tab reducer tests.
- Web/server/contracts keybinding tests.
- Desktop application menu/window-close tests.
- Route search-state tests for right-panel file explorer state.

## Task Window Toggle

### Branch Scope

This branch adds a task window shortcut that opens and closes the existing chat plan/tasks sidebar with `Mod+Shift+T`. It keeps task activity in the task UI that already exists in `ChatView`.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

### Major Changes

- Added task window keybinding:
  - `taskWindow.toggle` was added to the contracts command list.
  - The shared default keybinding maps it to `mod+shift+t` outside terminal focus.
  - Web keybinding helpers and `ChatView` toggle the existing plan/tasks sidebar.
- Preserved right-panel route behavior:
  - `panel=diff` remains the diff panel state.
  - `panel=files` remains the file explorer panel state.
  - Legacy `diff=1` remains supported as a compatibility alias for the diff panel.
  - `panel=tasks` is ignored so stale URLs cannot open a second task surface.

### Reasons For The Changes

- Task lifecycle and plan step activity already render in the existing chat sidebar, but there was no direct task-window shortcut for opening and closing it.
- Reusing the existing sidebar avoids creating a second task window and keeps task inspection in the same surface as the composer task toggle.
- Preserving `diff=1` avoids breaking existing diff links and navigation state.
- The task window shortcut is optimized for keyboard-heavy operator workflows.

### Architectural Context For Syncing

- `diffRouteSearch.ts` remains responsible for right-panel route state and `diff=1` compatibility. Do not reintroduce `panel=tasks` unless the existing chat task sidebar is intentionally replaced.
- The task window uses `ChatView`'s `planSidebarOpen` state and `PlanSidebar` rendering path.
- `taskWindow.toggle` is part of the shared keybinding contract. Keep contracts, shared defaults, web matching, and settings labels in sync when resolving keybinding conflicts.
- The default shortcut excludes terminal focus through the shared `when: "!terminalFocus"` condition. Keep that guard unless terminal key handling is explicitly made right-panel aware.

### Files Most Likely To Conflict

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/diffRouteSearch.ts`
- `apps/web/src/diffRouteSearch.test.ts`
- `apps/web/src/keybindings.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/shared/src/keybindings.ts`

### Verification Added On Branch

- Route search parsing tests for `panel=diff`, ignored `panel=tasks`, and legacy `diff=1`.
- Assertions that task route state does not make the diff panel appear open.
- Keybinding contract/default updates for `taskWindow.toggle`.
## Terminal Tab Navigation

### Branch Scope

This branch expands terminal UX and state management. It adds terminal tab/group navigation, split-terminal state with nested mixed-orientation layouts, focus navigation inside split groups, a configurable terminal view mode, and bottom-vs-right terminal placement with per-thread placement state.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

### Major Changes

- Added terminal domain language and planning docs:
  - `CONTEXT.md` defines the canonical terms Terminal drawer, Terminal placement, Terminal dimensions, Logical project, Terminal view mode, Terminal split orientation, and Terminal split layout.
  - `docs/terminal-placement.md` records the placement plan, resolved decisions, completed sessions, and remaining risks.
  - `docs/terminal-splits.md` records the horizontal/nested split plan, design decisions, and implementation phases.
- Expanded terminal state from a single active terminal into grouped terminal state:
  - Thread terminal state now tracks `terminalIds`, `terminalGroups`, `activeTerminalId`, `activeTerminalGroupId`, and running terminal ids.
  - `splitTerminal` adds a terminal into the active group, capped by `MAX_TERMINALS_PER_GROUP`. Accepts an orientation (`"vertical"` or `"horizontal"`) and an optional anchor terminal id.
  - `newTerminal` creates a new group/tab.
  - Closing a terminal preserves a valid active terminal and resets only when the final terminal closes.
  - Terminal event buffers are kept outside persisted UI state and are cleared when terminal state is removed.
- Added nested split layout model:
  - `TerminalSplitOrientation` (`"vertical" | "horizontal"`) and `TerminalSplitLayout` (recursive binary tree of terminal leaves and split nodes) defined in `apps/web/src/types.ts`.
  - `ThreadTerminalGroup` extended with optional `splitOrientation` and `splitLayout`.
  - Split layout helpers: `normalizeTerminalSplitLayout` validates and rebuilds layouts against the group's terminal ids, `insertTerminalIntoSplitLayout` nests a new terminal under the anchor pane, `pruneTerminalFromSplitLayout` removes a terminal and collapses single-child split nodes.
  - Equality, copy, and collection helpers updated to include split layout fields.
  - Existing persisted groups without a split layout are normalized to a flat vertical layout for backward compatibility.
- Added terminal tab and split navigation UI:
  - `ThreadTerminalDrawer` derives drawer layout in `resolveThreadTerminalDrawerLayout`, now including `visibleSplitLayout` for the active group.
  - Tabs represent terminal groups; split groups render terminals using `TerminalSplitLayoutView`, a recursive component that renders nested grids (columns for vertical splits, rows for horizontal splits).
  - Toolbar actions support vertical splitting, horizontal splitting, creating, closing, tab switching, and cycling focus within the active split group.
  - Horizontal split button added to all three toolbar variants (floating controls, tabs mode, sidebar mode) with disabled state at max capacity and shortcut label tooltips.
  - Split shortcuts handled inside `TerminalViewport`'s xterm custom key handler pass the focused pane's terminal id as the anchor; global ChatView handlers fall back to the active terminal.
  - Browser/test coverage verifies drawer layout, split layout resolution, and event replay behavior.
- Added terminal view mode:
  - Client settings include `terminalViewMode` for sidebar vs tabs organization.
  - Settings UI exposes the terminal view mode without conflating it with terminal placement.
  - `ThreadTerminalDrawer` changes chrome based on view mode while preserving the same terminal sessions.
- Added terminal placement:
  - Contracts define `TerminalPlacement = "bottom" | "right"` and `DEFAULT_TERMINAL_PLACEMENT`.
  - Client settings include `defaultTerminalPlacement`.
  - Thread terminal state stores `terminalPlacement` lazily from the global default.
  - Placement toggles only the active thread's saved placement and does not open a closed drawer.
  - Terminal dimensions moved to logical-project state with independent `terminalHeight` and `terminalWidth`.
  - Legacy per-thread terminal height is used as a fallback when seeding logical-project dimensions.
  - `ChatView` renders bottom placement below the chat workspace and right placement inside the main horizontal workspace.
  - Narrow viewports use an effective bottom placement without mutating the saved right placement.
  - `ThreadTerminalDrawer` supports bottom height resizing and right width resizing.
  - Placement toggle buttons are available in the single-terminal floating controls, tabs mode, and sidebar mode.
- Added keybinding commands and defaults:
  - `terminal.togglePlacement` defaults to `mod+shift+j`.
  - `terminal.splitHorizontal` defaults to `mod+shift+d` with `when: "terminalFocus"`.
  - `terminal.tabPrevious` defaults to `mod+[`.
  - `terminal.tabNext` defaults to `mod+]`.
  - `terminal.splitFocusNext` defaults to `mod+\`.
  - `TerminalShortcutAction` union extended with `"splitHorizontal"`; `terminalShortcutActionFromCommand` maps the new command.
  - Server, web, contracts, and settings tests were updated for the expanded command set.

### Reasons For The Changes

- Agent workflows commonly need more than one terminal context. Grouped terminals allow users to keep independent shells while still splitting related terminals in one visible group.
- Tab/group navigation keeps terminal switching predictable without forcing every terminal into the same split view.
- Split focus navigation is needed because keyboard users should not have to click between panes inside a split group.
- Terminal placement needs a clean domain boundary. Separating Terminal placement from Terminal view mode avoids overloading "mode" and prevents future merge confusion.
- Terminal dimensions are logical-project scoped because equivalent project checkouts across environments should feel consistent, while terminal placement remains thread-specific.
- Placement toggling is intentionally UI-only state. It must not restart, close, or recreate terminal sessions.
- Right placement gives terminal-heavy workflows more vertical room while preserving the same terminal sessions and thread-scoped presentation state.

### Architectural Context For Syncing

- Preserve the distinction between **Terminal placement** and **Terminal view mode**. Placement is bottom vs right; view mode is tabs vs sidebar. Do not merge these into one enum.
- Preserve the distinction between **Terminal split orientation** and **Terminal placement**. Split orientation is per split node inside a group; placement is bottom vs right for the whole drawer.
- `CONTEXT.md` is a glossary only. Keep implementation details in `docs/terminal-placement.md`, `docs/terminal-splits.md`, or code comments, not in the glossary.
- Thread terminal state owns session presentation identity: open/closed state, placement, terminal ids, groups, active terminal, active group, split layouts, and running subprocess ids.
- Split orientation is established per split node, not per group or per drawer. A single terminal group can contain mixed vertical and horizontal split nodes (tmux-style nesting).
- The split anchor model: xterm-pane shortcut handlers pass their own `terminalId` as the anchor; toolbar and global ChatView handlers fall back to the active terminal. New terminals are inserted adjacent to the anchor in both the `terminalIds` array and the split layout tree.
- Logical-project terminal dimension state owns layout sizes: bottom height and right width. Keep those dimensions independent; never derive one from the other when placement changes.
- Right placement rendering consumes the existing `terminalPlacement` and `terminalWidth` state. Do not introduce another placement store.
- `ChatView` owns effective placement. It may render bottom on narrow screens even when the saved thread placement is right, but it must not rewrite the saved placement during that fallback.
- `ThreadTerminalDrawer` layout derivation is centralized in `resolveThreadTerminalDrawerLayout`. Keep tab/group/split/layout derivation there so UI rendering and tests stay aligned.
- `TerminalSplitLayoutView` renders split layouts recursively: vertical nodes use column grids, horizontal nodes use row grids. Each terminal leaf delegates to `TerminalViewport`.
- Keybinding commands must stay synchronized across `packages/contracts`, `packages/shared`, `apps/server`, and `apps/web`. This branch touches all of them.
- The terminal drawer remains persistent per mounted thread. Hidden terminal drawers for non-active threads should not be affected by active-thread placement or keybinding actions.
- The `KEYBINDINGS.md` command list includes the new terminal tab and split-focus commands, but its defaults block may lag the shared defaults. Treat `packages/shared/src/keybindings.ts` as the source of truth for defaults.

### Files Most Likely To Conflict

- `apps/web/src/terminalStateStore.ts`
- `apps/web/src/terminalStateStore.test.ts`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.test.ts`
- `apps/web/src/components/ThreadTerminalDrawer.browser.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/types.ts`
- `apps/web/src/keybindings.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/shared/src/keybindings.ts`
- `apps/server/src/keybindings.ts`
- `KEYBINDINGS.md`
- `CONTEXT.md`
- `docs/terminal-placement.md`
- `docs/terminal-splits.md`

### Verification Added On Branch

- Terminal store tests for grouped terminals, split caps, new groups, active-terminal fallback, placement defaulting, placement toggling, logical-project dimensions, legacy height fallback, event buffers, and subprocess activity.
- Terminal store tests for split orientation: vertical first split, horizontal first split, nested mixed-orientation splits, anchor-specific insertion, and legacy missing-layout normalization.
- Thread terminal drawer tests for layout derivation, terminal tabs, split metadata, split layout resolution (including horizontal orientation), event replay, and selection action positioning.
- Keybinding tests across contracts, server, and web for placement, tab navigation, split-focus, and `terminal.splitHorizontal` commands.
- Settings tests for `defaultTerminalPlacement` and `terminalViewMode` defaults/patching.
- Browser coverage for chat terminal shortcut behavior and `onSplitTerminalShortcut` prop wiring.
- Required checks: `bun run test`, `bun fmt`, `bun lint`, and `bun typecheck`.
