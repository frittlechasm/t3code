# Terminal Placement Plan

T3 Code currently renders the persistent terminal drawer at the bottom of the chat view. This plan adds a second placement, right side, plus a shortcut and a default setting so users can switch between bottom and right-hand terminal layouts without changing terminal sessions.

## Canonical Terms

- **Terminal drawer**: The persistent terminal UI attached to a thread.
- **Terminal placement**: The terminal drawer's screen position: bottom or right.
- **Terminal view mode**: The existing internal terminal organization setting: sidebar or tabs.

Do not reuse **terminal view mode** for bottom-vs-right placement; it already means tabs-vs-sidebar in `TerminalViewMode`.

## Current Code Shape

- Terminal UI state lives in `apps/web/src/terminalStateStore.ts` and is keyed by scoped thread identity.
- The terminal drawer component is `apps/web/src/components/ThreadTerminalDrawer.tsx`.
- Chat layout composes the terminal after the main horizontal flex area in `apps/web/src/components/ChatView.tsx`, which makes the drawer bottom-mounted today.
- Keybinding commands are defined in `packages/contracts/src/keybindings.ts`, defaults in `packages/shared/src/keybindings.ts`, and resolution in `apps/web/src/keybindings.ts`.
- Client settings live in `packages/contracts/src/settings.ts` and are edited in `apps/web/src/components/settings/SettingsPanels.tsx`.

## Product Behavior

- Users can place the terminal drawer at the bottom or on the right side of the chat area.
- A command toggles terminal placement between bottom and right.
- The command is available as a configurable keybinding.
- The placement toggle changes placement only; it does not open a closed terminal drawer.
- The placement toggle updates only the active thread's saved placement.
- The open terminal drawer includes a compact placement toggle button.
- The placement toggle button is visible in every terminal drawer toolbar variant.
- A general setting controls the default terminal placement for new/unknown thread terminal UI state.
- Changing the default terminal placement does not rewrite existing thread placement overrides.
- Terminal drawer height and width are logical-project scoped layout preferences.
- Equivalent projects grouped into the same logical project share terminal dimensions across environments.
- Existing terminal sessions, terminal groups, split terminals, active terminal, running subprocess state, and event buffers are preserved when placement changes.
- Placement is UI-only; no server terminal lifecycle should restart because the drawer moves.
- Terminal placement does not override terminal view mode.

## Design Decisions To Resolve

1. Scope of placement persistence: global default plus thread override.
2. Default shortcut: add an active default keybinding, while keeping the command configurable.
3. Right-placement sizing: resizable width only; height is controlled by the surrounding chat layout.
4. Mobile behavior: force bottom placement under a breakpoint without mutating the saved placement.
5. Conflict behavior with the plan sidebar and diff panel: the right terminal shares the main chat workspace; existing sidebars and sheets keep their current behavior.

## Recommended Direction

- Add `TerminalPlacement = "bottom" | "right"` as a client setting concept separate from `TerminalViewMode`.
- Store actual placement by thread, initialized from `settings.defaultTerminalPlacement`.
- Store terminal dimensions by logical project, initialized from default dimensions.
- Initialize terminal layout lazily when terminal state is first read or changed, rather than when a thread is created.
- Add `terminal.togglePlacement` as a keybinding command.
- Ship the command with `mod+shift+j` by default, pairing it with the existing `mod+j` terminal visibility toggle while keeping it configurable in Keybindings settings.
- Add width persistence separately from height: `terminalHeight` applies to bottom placement and `terminalWidth` applies to right placement.
- Maintain both dimensions independently for each logical project from the start; never derive one from the other when placement changes.
- Bottom placement is vertically resizable through `terminalHeight`; right placement is horizontally resizable through `terminalWidth`.
- On narrow screens, render bottom even if the stored placement is right, without mutating the stored preference.
- When plan sidebar or diff panel is open, keep terminal right placement as part of the main chat region and let existing right overlays/sheets continue to overlay above it on small screens.
- Keep `TerminalViewMode` independent from placement; tabs/sidebar behavior is the same in bottom and right placements.

## Phases

### Phase 1: Contracts and State

- Add `TerminalPlacement` schema and `DEFAULT_TERMINAL_PLACEMENT` to `packages/contracts/src/settings.ts`.
- Add `defaultTerminalPlacement` to `ClientSettingsSchema`.
- Extend thread terminal UI state with `terminalPlacement`.
- Add logical-project terminal dimension state for `terminalHeight` and `terminalWidth`.
- Keep terminal sessions, terminal ids, terminal groups, active terminal, running subprocess ids, launch context, event buffers, and placement thread-scoped.
- Add migration/defaulting logic so existing persisted terminal state continues to decode while new thread placement state starts from the global default.
- Add store actions for `setTerminalPlacement` and `toggleTerminalPlacement` against the active thread.
- Add store actions for `setTerminalHeight` and `setTerminalWidth` against the active logical project.
- Cover state migration and toggle behavior in `apps/web/src/terminalStateStore.test.ts`.

### Phase 2: Keybinding Command

- Add `terminal.togglePlacement` to the static keybinding command list.
- Add command label support in keybinding settings.
- Add shortcut resolver/action plumbing in `apps/web/src/keybindings.ts`.
- Wire global shortcut handling in `ChatView` to toggle placement without opening/closing the terminal.
- Add focused tests in `packages/contracts/src/keybindings.test.ts` and `apps/web/src/keybindings.test.ts`.

### Phase 3: Layout Refactor

- Refactor `PersistentThreadTerminalDrawer` and `ThreadTerminalDrawer` so placement is an explicit prop.
- For bottom placement, preserve current height resize behavior.
- For right placement, render the drawer inside the main horizontal chat layout with a resizable width.
- Ensure xterm fit recalculates after placement and size changes.
- Preserve hidden persistent terminal mounting for non-active open thread terminals.
- Add browser/UI tests around moving an open terminal between placements without re-opening its session.

### Phase 4: Settings UI

- Add a General settings row for default terminal placement.
- Place it next to the existing terminal view mode row.
- Keep the existing terminal view mode row for tabs/sidebar unchanged.
- Add reset behavior for the new setting.
- Add tests for settings patching/defaults where existing settings tests cover similar rows.

### Phase 5: Polish and Verification

- Add a terminal toolbar button for placement; its tooltip includes the configured shortcut label when available.
- Verify plan sidebar, diff panel, branch toolbar, composer, and scroll-to-bottom behavior in both placements.
- Run `bun fmt`, `bun lint`, and `bun typecheck`.
- Run targeted tests with `bun run test` only; never run `bun test`.

## Session Plan

### Session 1: Contracts and Settings Defaults

Goal: introduce the placement concept without changing chat layout.

- Add `TerminalPlacement` and `DEFAULT_TERMINAL_PLACEMENT` to contracts.
- Add `defaultTerminalPlacement` to client settings defaults and patches.
- Add the General settings row beside terminal view mode.
- Update desktop/client settings fixtures that require exhaustive `ClientSettings`.
- Stop when settings can persist the new default and all checks pass.

Verification:

- `bun run test packages/contracts/src/settings.test.ts` if a focused settings test exists or is added.
- Relevant settings/component tests if touched.
- `bun fmt`, `bun lint`, `bun typecheck`.

### Session 2: Thread Placement State

Goal: persist placement per thread and wire non-layout actions.

- Extend terminal thread state with `terminalPlacement`.
- Make lazy terminal state initialization seed placement from `defaultTerminalPlacement`.
- Add `setTerminalPlacement` and `toggleTerminalPlacement`.
- Keep placement toggle independent from terminal open/closed state.
- Stop before changing drawer layout.

Verification:

- `bun run test apps/web/src/terminalStateStore.test.ts`.
- `bun fmt`, `bun lint`, `bun typecheck`.

### Session 3: Logical-Project Dimensions

Goal: persist terminal dimensions by logical project.

- Add logical-project terminal dimension state for `terminalHeight` and `terminalWidth`.
- Move bottom height persistence from thread state to logical-project dimension state.
- Add right-width persistence without rendering right placement yet.
- Preserve migration for existing thread `terminalHeight` values by seeding the active logical project where possible, or falling back to the default height when no project can be resolved.
- Stop before visual layout changes.

Verification:

- `bun run test apps/web/src/terminalStateStore.test.ts`.
- Add focused tests for logical-project dimension sharing across environments.
- `bun fmt`, `bun lint`, `bun typecheck`.

### Session 4: Keybinding Command

Goal: make placement toggling available through the keybinding system.

- Add `terminal.togglePlacement` to keybinding contracts.
- Add default `mod+shift+j`.
- Add label/action plumbing in web keybinding helpers.
- Wire global shortcut handling to update only the active thread's placement.
- Stop before adding the visible toolbar button.

Verification:

- `bun run test packages/contracts/src/keybindings.test.ts`.
- `bun run test apps/web/src/keybindings.test.ts`.
- Any focused `ChatView` shortcut test if added.
- `bun fmt`, `bun lint`, `bun typecheck`.

### Session 5: Right Placement Layout

Goal: render the terminal drawer on the right without changing terminal session lifecycle.

- Refactor `ChatView` so effective placement controls whether the drawer renders below or inside the main horizontal workspace.
- Add right placement width sizing and resize handle.
- Keep bottom placement height resizing unchanged.
- Add narrow-screen `effectiveTerminalPlacement` fallback to bottom without mutating saved placement.
- Ensure xterm fit recalculates on placement and dimension changes.
- Stop before toolbar polish if the layout itself is not stable.

Verification:

- Existing `ThreadTerminalDrawer` browser tests.
- New browser/UI coverage for moving an open terminal without re-opening its session.
- Manual browser check for bottom, right, and narrow viewport behavior.
- `bun fmt`, `bun lint`, `bun typecheck`.

### Session 6: Toolbar Toggle and Polish

Goal: make placement discoverable in every drawer toolbar variant.

- Add one compact placement toggle button to each drawer toolbar variant: single-terminal floating controls, tabs mode, and sidebar mode.
- Include the configured shortcut label in the tooltip when available.
- Verify plan sidebar, diff panel, branch toolbar, composer, and scroll-to-bottom behavior in both placements.
- Tighten styling and accessible labels.

Verification:

- `ThreadTerminalDrawer` unit/browser tests for toolbar variants.
- Manual browser check for single, tabs, and sidebar terminal view modes.
- `bun fmt`, `bun lint`, `bun typecheck`.

## Open Risks

- Right placement competes for horizontal space with the plan sidebar and any future right-side panels.
- xterm fit timing can be fragile when moving between layout containers.
- Persisting thread placement may surprise users who expect the default setting to apply immediately everywhere.
- A default shortcut may conflict with terminal shell shortcuts while terminal focus is active.

## Resolved Decisions

- No ADR will be created for the current scope model. Any future ADR discussion should be handled as a separate planning task.
- Terminal placement uses a global default plus thread override. The setting controls the initial placement for threads with no saved terminal placement; after a user moves a terminal drawer, that thread remembers its placement.
- Changing the global default only affects threads without saved terminal placement. It must not immediately move open terminals whose thread already has saved placement.
- Terminal dimensions are logical-project scoped: bottom placement saves height, and right placement saves width for the logical project.
- Logical-project dimensions are independent: resizing bottom updates only `terminalHeight`, resizing right updates only `terminalWidth`, and placement changes never convert between them.
- When multiple physical projects resolve to the same logical project, terminal dimensions are shared across those environments. Terminal placement remains thread-specific and does not cross that boundary.
- Thread terminal layout is initialized lazily. Threads that never use terminal state do not need persisted terminal layout entries.
- `terminal.togglePlacement` ships with a default `mod+shift+j` shortcut and remains configurable through the existing keybindings system.
- Right placement is width-resizable only. Moving the terminal drawer to the right must not expose a height resize handle.
- Narrow screens use an `effectiveTerminalPlacement` of bottom even when persisted `terminalPlacement` is right. Returning to a wide viewport restores the saved right placement.
- Right terminal placement does not close, hide, or replace the plan sidebar or diff panel. It occupies space inside the main chat workspace; existing sidebar/sheet behavior remains responsible for plan and diff surfaces.
- `terminal.togglePlacement` works even when the terminal drawer is closed, but it does not open the drawer. The next terminal open uses the updated placement.
- Placement commands target only the active thread. Hidden mounted terminal drawers for other threads are not changed by the active thread's shortcut or toolbar action.
- The terminal drawer includes a small placement toggle button in its toolbar so the feature is discoverable without knowing the shortcut.
- The placement toggle button appears once in every drawer toolbar variant: single-terminal floating controls, tabs mode, and sidebar mode.
- Default terminal placement lives in Settings -> General, adjacent to the existing terminal view mode setting, with Bottom and Right options.
- Terminal view mode remains independent. Right placement must not force tabs or sidebar mode.
