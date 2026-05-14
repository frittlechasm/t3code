# PATCH: feat/terminal-tab-navigation

## Branch Scope

This branch expands terminal UX and state management. It adds terminal tab/group navigation, split-terminal state, focus navigation inside split groups, a configurable terminal view mode, and the data/settings/keybinding foundation for future bottom-vs-right terminal placement.

Base used for this summary: `upstream/main` at merge-base `447236d51f4d6835482f6707d627dbc8a39eb553`.

Important scope boundary: this branch adds terminal placement contracts, settings, state, and toggle commands, but the actual right-side terminal drawer rendering is still documented as future work in `docs/terminal-placement.md`.

## Major Changes

- Added terminal domain language and planning docs:
  - `CONTEXT.md` defines the canonical terms Terminal drawer, Terminal placement, Terminal dimensions, Logical project, and Terminal view mode.
  - `docs/terminal-placement.md` records the placement plan, resolved decisions, completed sessions, and remaining layout/polish risks.
- Expanded terminal state from a single active terminal into grouped terminal state:
  - Thread terminal state now tracks `terminalIds`, `terminalGroups`, `activeTerminalId`, `activeTerminalGroupId`, and running terminal ids.
  - `splitTerminal` adds a terminal into the active group, capped by `MAX_TERMINALS_PER_GROUP`.
  - `newTerminal` creates a new group/tab.
  - Closing a terminal preserves a valid active terminal and resets only when the final terminal closes.
  - Terminal event buffers are kept outside persisted UI state and are cleared when terminal state is removed.
- Added terminal tab and split navigation UI:
  - `ThreadTerminalDrawer` derives drawer layout in `resolveThreadTerminalDrawerLayout`.
  - Tabs represent terminal groups; split groups render multiple terminals side by side.
  - Toolbar actions support splitting, creating, closing, tab switching, and cycling focus within the active split group.
  - Browser/test coverage verifies drawer layout and event replay behavior.
- Added terminal view mode:
  - Client settings include `terminalViewMode` for sidebar vs tabs organization.
  - Settings UI exposes the terminal view mode without conflating it with terminal placement.
  - `ThreadTerminalDrawer` changes chrome based on view mode while preserving the same terminal sessions.
- Added terminal placement foundation:
  - Contracts define `TerminalPlacement = "bottom" | "right"` and `DEFAULT_TERMINAL_PLACEMENT`.
  - Client settings include `defaultTerminalPlacement`.
  - Thread terminal state stores `terminalPlacement` lazily from the global default.
  - Placement toggles only the active thread's saved placement and does not open a closed drawer.
  - Terminal dimensions moved to logical-project state with independent `terminalHeight` and `terminalWidth`.
  - Legacy per-thread terminal height is used as a fallback when seeding logical-project dimensions.
- Added keybinding commands and defaults:
  - `terminal.togglePlacement` defaults to `mod+shift+j`.
  - `terminal.tabPrevious` defaults to `mod+[`.
  - `terminal.tabNext` defaults to `mod+]`.
  - `terminal.splitFocusNext` defaults to `mod+\`.
  - Server, web, contracts, and settings tests were updated for the expanded command set.

## Reasons For The Changes

- Agent workflows commonly need more than one terminal context. Grouped terminals allow users to keep independent shells while still splitting related terminals in one visible group.
- Tab/group navigation keeps terminal switching predictable without forcing every terminal into the same split view.
- Split focus navigation is needed because keyboard users should not have to click between panes inside a split group.
- Terminal placement needs a clean domain boundary before layout changes. Separating Terminal placement from Terminal view mode avoids overloading "mode" and prevents future merge confusion.
- Terminal dimensions are logical-project scoped because equivalent project checkouts across environments should feel consistent, while terminal placement remains thread-specific.
- Placement toggling is intentionally UI-only state. It must not restart, close, or recreate terminal sessions.

## Architectural Context For Syncing

- Preserve the distinction between **Terminal placement** and **Terminal view mode**. Placement is bottom vs right; view mode is tabs vs sidebar. Do not merge these into one enum.
- `CONTEXT.md` is a glossary only. Keep implementation details in `docs/terminal-placement.md` or code comments, not in the glossary.
- Thread terminal state owns session presentation identity: open/closed state, placement, terminal ids, groups, active terminal, active group, and running subprocess ids.
- Logical-project terminal dimension state owns layout sizes: bottom height and right width. Keep those dimensions independent; never derive one from the other when placement changes.
- Placement state is already persisted even though right placement rendering is not complete on this branch. Future layout work should consume `terminalPlacement` and `terminalWidth` instead of introducing another placement store.
- `ThreadTerminalDrawer` layout derivation is centralized in `resolveThreadTerminalDrawerLayout`. Keep tab/group/split derivation there so UI rendering and tests stay aligned.
- Keybinding commands must stay synchronized across `packages/contracts`, `packages/shared`, `apps/server`, and `apps/web`. This branch touches all of them.
- The terminal drawer remains persistent per mounted thread. Hidden terminal drawers for non-active threads should not be affected by active-thread placement or keybinding actions.
- The `KEYBINDINGS.md` command list includes the new terminal tab and split-focus commands, but its defaults block may lag the shared defaults. Treat `packages/shared/src/keybindings.ts` as the source of truth for defaults.

## Files Most Likely To Conflict

- `apps/web/src/terminalStateStore.ts`
- `apps/web/src/terminalStateStore.test.ts`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.test.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/keybindings.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/shared/src/keybindings.ts`
- `apps/server/src/keybindings.ts`
- `KEYBINDINGS.md`
- `CONTEXT.md`
- `docs/terminal-placement.md`

## Verification Added On Branch

- Terminal store tests for grouped terminals, split caps, new groups, active-terminal fallback, placement defaulting, placement toggling, logical-project dimensions, legacy height fallback, event buffers, and subprocess activity.
- Thread terminal drawer tests for layout derivation, terminal tabs, split metadata, event replay, and selection action positioning.
- Keybinding tests across contracts, server, and web for placement, tab navigation, and split-focus commands.
- Settings tests for `defaultTerminalPlacement` and `terminalViewMode` defaults/patching.
- Browser coverage for chat terminal shortcut behavior.
