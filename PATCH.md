# PATCH: feat/task-window-toggle

## Branch Scope

This branch adds a task activity side panel that can be opened from chat with `Mod+Shift+T`. It reuses the existing right-side diff panel infrastructure, extends route search state from a diff-only toggle into a generic right-panel selector, and renders task lifecycle activity from the active thread.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

## Major Changes

- Added `TaskPanel`:
  - Reads the active thread from the route params and store.
  - Filters `task.started`, `task.progress`, and `task.completed` orchestration activities.
  - Collapses activity by `taskId` so each task appears once with its latest label/status.
  - Displays running, completed, failed, and stopped task states in the existing `DiffPanelShell`.
- Generalized right-panel route state:
  - `diffRouteSearch.ts` now supports `panel=diff` and `panel=tasks`.
  - Legacy `diff=1` remains supported as a compatibility alias for the diff panel.
  - Diff-specific params are only retained when the diff panel is actually open.
- Wired task panel layout:
  - The chat route lazily imports `TaskPanel`.
  - Desktop/tablet inline sidebar and mobile sheet handling mirror the existing diff panel behavior.
  - The task panel stays mounted after first open so repeated toggles do not discard local render state.
- Added task window keybinding:
  - `taskWindow.toggle` was added to the contracts command list.
  - The shared default keybinding maps it to `mod+shift+t` outside terminal focus.
  - Web keybinding helpers and `ChatView` route handlers toggle `panel=tasks`.

## Reasons For The Changes

- Task lifecycle events already exist in thread activity, but there was no focused UI for quickly inspecting current and completed tasks.
- The right side of chat was already the natural place for secondary execution context because diff details lived there. Reusing that surface keeps task inspection predictable.
- The route should represent which right panel is open instead of multiplying independent booleans. `panel=tasks` avoids ambiguous states where diff and task panels could both claim the same side panel.
- Preserving `diff=1` avoids breaking existing links and navigation state while allowing new panel types.
- The task panel is shortcut-driven because this app is optimized for keyboard-heavy operator workflows.

## Architectural Context For Syncing

- `diffRouteSearch.ts` now has a broader responsibility than its name suggests: it owns right-panel search state, while still preserving diff compatibility. If upstream renames or splits this module, keep the compatibility behavior for `diff=1`.
- `panel` is the canonical new route param. Treat `diff=1` as a legacy alias only.
- The task panel depends on orchestration activity shape, especially payload `taskId`, `summary`, `description`, and completed payload `status`. If upstream changes task event payloads, update `TaskPanel` extraction helpers rather than pushing parsing into `ChatView`.
- `TaskPanel` intentionally uses `DiffPanelShell` to share sidebar/sheet chrome with diff views. If upstream introduces a renamed generic panel shell, migrate both diff and tasks together.
- `taskWindow.toggle` is part of the shared keybinding contract. Keep contracts, shared defaults, web matching, and settings labels in sync when resolving keybinding conflicts.
- The default shortcut excludes terminal focus through the shared `when: "!terminalFocus"` condition. Keep that guard unless terminal key handling is explicitly made right-panel aware.

## Files Most Likely To Conflict

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/diffRouteSearch.ts`
- `apps/web/src/diffRouteSearch.test.ts`
- `apps/web/src/keybindings.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/shared/src/keybindings.ts`

## Verification Added On Branch

- Route search parsing tests for `panel=diff`, `panel=tasks`, and legacy `diff=1`.
- Assertions that task panel state does not make the diff panel appear open.
- Keybinding contract/default updates for `taskWindow.toggle`.
