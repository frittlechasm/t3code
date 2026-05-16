# Terminal Splits Plan

T3 Code supports multiple terminals inside a thread terminal drawer. A split terminal group is the set of terminal panes shown together in the drawer content area.

## Canonical Terms

- **Terminal drawer**: The persistent terminal UI attached to a thread.
- **Terminal view mode**: The drawer's internal organization style for multiple terminals: tabs or sidebar.
- **Terminal split orientation**: The direction in which one split node arranges its child terminal panes.
- **Terminal split layout**: The nested arrangement of split terminal panes inside a terminal group.

Do not use **terminal placement** for split direction. Placement is bottom-versus-right for the whole drawer.

## Current Code Shape

- Terminal UI state lives in `apps/web/src/terminalStateStore.ts`.
- Terminal group shape is defined by `ThreadTerminalGroup` in `apps/web/src/types.ts`.
- The drawer layout resolver is `resolveThreadTerminalDrawerLayout` in `apps/web/src/components/ThreadTerminalDrawer.tsx`.
- Split rendering uses nested grid containers so each split node can be side-by-side or stacked.
- Terminal keybinding commands are defined in `packages/contracts/src/keybindings.ts`, defaults in `packages/shared/src/keybindings.ts`, and resolved in `apps/web/src/keybindings.ts`.
- Terminal-pane shortcuts are handled inside `TerminalViewport` through xterm's custom key event handler.

## Product Behavior

- Existing split behavior remains unchanged: `terminal.split` creates a side-by-side split.
- Add a horizontal split command that creates stacked split panes.
- Default shortcut for horizontal split is `mod+shift+d` with `when: "terminalFocus"`.
- On macOS, `mod+shift+d` is `Cmd+Shift+D`; elsewhere it is `Ctrl+Shift+D`.
- Split commands target the focused terminal pane's terminal group.
- If a split command is handled outside a specific xterm pane, it falls back to the active terminal.
- Each split command replaces the focused terminal pane with a new split node using that command's orientation.
- A terminal group can contain mixed side-by-side and stacked split nodes, matching tmux-style nested splitting.
- Different terminal groups in the same terminal drawer may have different split layouts.
- Add a visible horizontal split button next to the existing split button in every terminal drawer toolbar variant.
- The horizontal split button tooltip includes the configured shortcut label when available.
- Existing persisted split groups without a split layout are treated as vertical side-by-side groups.

## Design Decisions

1. Scope of orientation: split-node-level, not drawer-level, thread-level, or group-level.
2. Command model: keep `terminal.split` for vertical side-by-side and add a separate horizontal split command.
3. Shortcut scope: default horizontal split shortcut is active only when terminal focus is true.
4. Anchor model: xterm-pane shortcut handlers pass their own `terminalId`; toolbar and global handlers use the active terminal.
5. Persistence: store a nested split layout on terminal groups once a split exists.
6. Compatibility: missing layout decodes as vertical for existing multi-terminal groups.

## Implementation Plan

### Phase 1: State Model

- Add `TerminalSplitOrientation = "vertical" | "horizontal"` in web terminal types.
- Add `TerminalSplitLayout` as a nested split tree.
- Extend `ThreadTerminalGroup` with optional `splitLayout`.
- Normalize terminal groups so missing layout is accepted.
- Preserve old persisted state by treating missing layout on multi-terminal groups as vertical.
- Update terminal group equality/copy helpers to include split layout.
- Replace `splitTerminal(threadRef, terminalId)` with an anchored split action that accepts orientation and optional anchor terminal id.
- Keep layout unset or irrelevant for single-terminal groups until the first split command is applied.

### Phase 2: Keybindings

- Add `terminal.splitHorizontal` to static keybinding commands.
- Add default `{ key: "mod+shift+d", command: "terminal.splitHorizontal", when: "terminalFocus" }`.
- Extend terminal shortcut action mapping with `splitHorizontal`.
- Add keybinding tests for shortcut resolution, labels, and terminal-focus scoping.

### Phase 3: Drawer Behavior

- Pass anchored split callbacks through `ChatView`, `ThreadTerminalDrawer`, and `TerminalViewport`.
- When xterm handles a split shortcut, pass that viewport's `terminalId` as the anchor.
- Render split layouts recursively: vertical nodes use column grids and horizontal nodes use row grids.
- Keep split focus cycling based on group terminal order, independent of visual orientation.
- Ensure xterm fit recalculates after nested split creation and layout changes.

### Phase 4: Toolbar

- Add a horizontal split button beside the existing split button in single-terminal floating controls, tabs mode, and sidebar mode.
- Use distinct icons for side-by-side and stacked split actions.
- Disable both split buttons when the active group has reached `MAX_TERMINALS_PER_GROUP`.
- Include configured shortcut labels in each tooltip.

### Phase 5: Verification

- Add terminal state tests for vertical first split, horizontal first split, nested mixed splits, anchor-specific insertion, and legacy missing layout.
- Add drawer layout tests for split layout resolution.
- Add keybinding tests in contracts/web/server where the existing keybinding command coverage requires it.
- Run targeted tests with `bun run test`; never use `bun test`.
- Before completion, run `bun fmt`, `bun lint`, and `bun typecheck`.

## Open Risks

- xterm fit timing may need an explicit resize epoch bump when changing nested split layouts.
- The toolbar can become crowded in the compact floating controls, so icon sizing and separators need visual verification.
- Browser or shell shortcuts may intercept `Ctrl+Shift+D` on some platforms before the web app receives it.

## Resolved Decisions

- No ADR is needed for this change.
- The existing vertical split command and shortcut remain unchanged.
- Horizontal split is a separate command with a separate default shortcut.
- Split orientation is established per split node.
- Existing multi-terminal groups can receive mixed-orientation nested splits.
- The split anchor is the focused terminal pane when available.
