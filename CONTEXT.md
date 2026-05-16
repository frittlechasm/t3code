# T3 Code

T3 Code is a web GUI for coding-agent sessions, their project context, and supporting workspace tools.

## Language

**Terminal drawer**:
The persistent terminal UI attached to a thread.
_Avoid_: Terminal window, terminal panel

**Terminal placement**:
The terminal drawer's screen position within the chat workspace.
_Avoid_: Terminal view mode, dock mode

**Terminal dimensions**:
The saved size of the terminal drawer for each placement.
_Avoid_: Terminal session size

**Logical project**:
A project identity that can group equivalent physical projects across environments.
_Avoid_: Physical project, environment project

**Terminal view mode**:
The terminal drawer's internal organization style for multiple terminals.
_Avoid_: Terminal placement

**Terminal split orientation**:
The direction in which one split node arranges its child terminal panes.
_Avoid_: Terminal placement, Terminal view mode

**Terminal split layout**:
The nested arrangement of split terminal panes inside a terminal group.
_Avoid_: Terminal placement, Terminal view mode

**Pinned terminal drawer**:
A terminal drawer promoted from thread scope to logical-project-plus-environment scope. It replaces per-thread drawers for all threads in the same logical project and environment while active.
_Avoid_: Shared terminal, global terminal, pinned terminal group

**Pinned session identity**:
A stable synthetic identifier used as the server-side `threadId` for terminal sessions in a pinned terminal drawer, independent of any real thread.
_Avoid_: Synthetic thread ID (in user-facing contexts)

## Relationships

- A **Terminal drawer** belongs to exactly one thread, unless it is a **Pinned terminal drawer**.
- A **Pinned terminal drawer** belongs to exactly one (**Logical project**, environment) pair.
- While a **Pinned terminal drawer** is active, threads in its scope have no independent **Terminal drawer**.
- A **Terminal drawer** has zero or one saved **Terminal placement**.
- A **Logical project** has saved **Terminal dimensions** for drawer layout.
- A **Terminal drawer** uses its saved **Terminal placement**, or the global default when none exists.
- A **Terminal drawer** has exactly one **Terminal view mode**.
- A split terminal group has zero or one **Terminal split layout**.
- A **Terminal split layout** has one or more **Terminal split orientation** nodes.

## Example Dialogue

> **Dev:** "Should changing **Terminal placement** restart the **Terminal drawer**?"
> **Domain expert:** "No. **Terminal placement** is UI-only; it moves the same **Terminal drawer** without changing the terminal session."

## Flagged Ambiguities

- "terminal window" was used for the persistent thread terminal UI; resolved: use **Terminal drawer**.
- "right side mode" could conflict with **Terminal view mode**; resolved: bottom versus right is **Terminal placement**.
- "project-specific" means **Logical project** for terminal dimensions.
- "horizontal splitting" means stacked split terminals within a terminal group, not **Terminal placement**.
- "terminal-specific split" means the split is anchored to the focused terminal's group.
- "group-level split orientation" prevents tmux-style mixed splits; resolved: use **Terminal split layout**.
- "pinned terminal group" could imply individual groups are pinned; resolved: the entire **Terminal drawer** is pinned as a **Pinned terminal drawer**.
- "shared terminal" or "global terminal" could imply app-wide scope; resolved: pinned drawers are scoped to a (**Logical project**, environment) pair.
