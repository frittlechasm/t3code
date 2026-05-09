# Task Window Toggle Shortcut Plan

## Goal

Add a keyboard shortcut to toggle a task window as a right-sidebar panel, following the same pattern established by the diff panel and file explorer panel. The task window shows runtime task activity (started, progress, completed) for the active session.

## Current State

- Runtime task events (`task.started`, `task.progress`, `task.completed`) are defined in `packages/contracts/src/providerRuntime.ts` with `RuntimeTaskId`, payload schemas, and event types.
- `apps/web/src/session-logic.ts` already processes task events into the activity feed — `task.started` is filtered out, while `task.progress` and `task.completed` are rendered as status entries with summaries.
- There is **no dedicated task panel**. Task activity is currently interleaved into the chat activity feed.
- The right panel system supports mutually exclusive panels via `panel` route search param (`"diff" | "files"`).
- The keybinding system supports conditional shortcuts with `when` clauses evaluated against context flags.

## Proposed Shortcut

`mod+shift+t` — Toggle task window (`Cmd+Shift+T` on macOS, `Ctrl+Shift+T` on Windows/Linux).

Rationale: `mod+t` is reserved for new tab in browsers/terminals. `mod+shift+t` is "reopen closed tab" in browsers but not a standard shortcut in most code editors, and follows the `mod+shift+<letter>` pattern used by the file explorer (`mod+shift+e`). Alternative: `mod+shift+k` if `mod+shift+t` conflicts.

## Implementation Plan

### Milestone 1 — Keybinding and Route State

**Files to modify:**

1. **`packages/contracts/src/keybindings.ts`**
   - Add `"taskWindow.toggle"` to `STATIC_KEYBINDING_COMMANDS`.

2. **`packages/shared/src/keybindings.ts`**
   - Add default binding: `{ key: "mod+shift+t", command: "taskWindow.toggle", when: "!terminalFocus" }`.

3. **`apps/web/src/keybindings.ts`**
   - Add `isTaskWindowToggleShortcut()` helper (follows `isFileExplorerToggleShortcut` pattern).

4. **`apps/web/src/diffRouteSearch.ts`**
   - Extend `RightPanelRoutePanel` type: `"diff" | "files" | "tasks"`.
   - Add helper `isTaskPanelOpen(search)` if needed, or rely on existing `getOpenRightPanel()`.

5. **`apps/web/src/components/ChatView.tsx`**
   - Add handler for `"taskWindow.toggle"` command that calls `onToggleTasks()`.
   - Thread `onToggleTasks` through ChatView props from the route component.

6. **`apps/web/src/routes/_chat.$environmentId.$threadId.tsx`**
   - Derive `tasksOpen` from parsed search params.
   - Add `openTasks`/`closeTasks` navigation callbacks (same pattern as `openDiff`/`closeDiff`).
   - Track `hasOpenedTasks` for lazy-mount.
   - Render `TaskPanelInlineSidebar` (inline layout) and `RightPanelSheet` (sheet layout).
   - Opening the task panel should close diff and file explorer (mutual exclusion via `panel` param).

### Milestone 2 — TaskPanel Component

**New file:** `apps/web/src/components/TaskPanel.tsx`

1. **Data source:** Subscribe to the session activity feed and filter for task-related events (`task.started`, `task.progress`, `task.completed`). Use existing session state atoms/selectors from `session-logic.ts`.

2. **Layout:** Use `DiffPanelShell` for consistent panel chrome (header with title + close button, content area). Accept `mode?: DiffPanelMode` prop.

3. **Task list rendering:**
   - Group tasks by `RuntimeTaskId`.
   - Show task label/summary, status indicator (spinner for in-progress, checkmark for completed), and timestamp.
   - Most recent tasks at top.
   - Empty state when no tasks are active.

4. **Panel width storage key:** `chat_task_window_sidebar_width`.

5. **Lazy loading:** Create `LazyTaskPanel` using `React.lazy()` following the `LazyDiffPanel` / `LazyFileExplorerPanel` pattern.

### Milestone 3 — Integration and Polish

1. **Mutual exclusion:** Verify that opening the task panel closes diff/file explorer and vice versa. The existing `panel` search param mechanism should handle this automatically since all three panels write to the same `panel` key.

2. **Responsive behavior:** Task panel should use sheet mode on narrow viewports, matching diff and file explorer behavior.

3. **Settings UI label:** The `commandLabel` formatter should auto-generate "Task Window: Toggle" from `"taskWindow.toggle"`. Verify this works.

### Milestone 4 — Tests and Validation

1. **Unit tests:**
   - `diffRouteSearch.test.ts` — add cases for `panel: "tasks"` parsing and `getOpenRightPanel` returning `"tasks"`.
   - Keybinding resolution test for `taskWindow.toggle`.

2. **Integration checks:**
   - `mod+shift+t` opens the task panel.
   - Pressing `mod+shift+t` again closes it.
   - Opening task panel closes diff if open (and vice versa).
   - Opening task panel closes file explorer if open (and vice versa).
   - Sheet mode renders correctly on narrow viewports.

3. **Standard checks:**
   - `bun fmt`
   - `bun lint`
   - `bun typecheck`

## Architecture Notes

- The task panel is a **read-only view** of existing session activity data. No new server-side RPC is needed — all task events are already streamed to the client via the WebSocket session.
- Panel state is URL-driven (route search param `panel: "tasks"`), consistent with diff and file explorer.
- The `DiffPanelShell` component is reusable across all right-panel types, so no new shell component is needed.
- Width persistence uses the same `SidebarProvider` + localStorage pattern as the other panels.

## Files Changed Summary

| File                                                     | Change                                             |
| -------------------------------------------------------- | -------------------------------------------------- |
| `packages/contracts/src/keybindings.ts`                  | Add `"taskWindow.toggle"` command                  |
| `packages/shared/src/keybindings.ts`                     | Add default `mod+shift+t` binding                  |
| `apps/web/src/keybindings.ts`                            | Add `isTaskWindowToggleShortcut` helper            |
| `apps/web/src/diffRouteSearch.ts`                        | Extend `RightPanelRoutePanel` to include `"tasks"` |
| `apps/web/src/components/ChatView.tsx`                   | Handle `taskWindow.toggle` command                 |
| `apps/web/src/routes/_chat.$environmentId.$threadId.tsx` | Wire up task panel open/close/render               |
| `apps/web/src/components/TaskPanel.tsx`                  | **New** — task panel component                     |
| `apps/web/src/diffRouteSearch.test.ts`                   | Add test cases for `"tasks"` panel                 |
