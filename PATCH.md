# PATCH: feat/task-window-toggle

## Branch Scope

This branch adds a task window shortcut that opens and closes the existing chat plan/tasks sidebar with `Mod+Shift+T`. It keeps the diff panel route state scoped to diff-only behavior so task activity continues to use the task UI that already exists in `ChatView`.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

## Major Changes

- Kept diff route state diff-only:
  - `diffRouteSearch.ts` supports `panel=diff`.
  - Legacy `diff=1` remains supported as a compatibility alias for the diff panel.
  - Diff-specific params are only retained when the diff panel is actually open.
  - `panel=tasks` is ignored so stale URLs cannot open a second task surface.
- Added task window keybinding:
  - `taskWindow.toggle` was added to the contracts command list.
  - The shared default keybinding maps it to `mod+shift+t` outside terminal focus.
  - Web keybinding helpers and `ChatView` toggle the existing plan/tasks sidebar.

## Reasons For The Changes

- Task lifecycle and plan step activity already render in the existing chat sidebar, but there was no direct task-window shortcut for opening and closing it.
- Reusing the existing sidebar avoids creating a second task window and keeps task inspection in the same surface as the composer task toggle.
- Preserving `diff=1` avoids breaking existing diff links and navigation state.
- The task window shortcut is optimized for keyboard-heavy operator workflows.

## Architectural Context For Syncing

- `diffRouteSearch.ts` remains responsible for diff panel route state and `diff=1` compatibility. Do not reintroduce `panel=tasks` unless the existing chat task sidebar is intentionally replaced.
- The task window uses `ChatView`'s `planSidebarOpen` state and `PlanSidebar` rendering path.
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

- Route search parsing tests for `panel=diff`, ignored `panel=tasks`, and legacy `diff=1`.
- Assertions that task route state does not make the diff panel appear open.
- Keybinding contract/default updates for `taskWindow.toggle`.
