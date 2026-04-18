# Branch: terminal-perf-impr

**Base:** `main`
**Commits:** 2

## Summary

Builds on `terminal-zshrc-fix` (shared shell env sync + Homebrew vars) and adds a terminal
pre-warm mechanism that opens the shell session in the background ~150 ms after a thread
becomes active, so the terminal drawer is ready instantly when the user opens it.

> This branch is a **strict superset** of `terminal-zshrc-fix`. If only one of the two can
> be merged, prefer this one.

---

## Changes

### 1. `fix(shell): consolidate env sync and expand list for homebrew vars` (`a532981`)

See [`branch-terminal-zshrc-fix.md`](./branch-terminal-zshrc-fix.md) for the full
breakdown. Short version: moves `syncShellEnvironment` to `packages/shared/src/shell.ts`,
adds Homebrew vars to the default capture list, makes the list configurable.

### 2. `perf(terminal): prewarm thread terminal sessions` (`849f816`)

**What:** When a thread is active but the terminal drawer is **closed**, a delayed
background `terminal.open` RPC is issued (150 ms after mount) so the shell process is
already running by the time the user opens the terminal.

Implementation:
- `buildTerminalPrewarmRequest(input)` — pure helper in `ChatView.logic.ts`; returns a
  `TerminalOpenInput | null`. Returns `null` if the terminal is already open, the thread ID
  is absent, or there is no working directory. Normalizes `terminalId` (falls back to
  `DEFAULT_THREAD_TERMINAL_ID`) and sorts `env` entries for determinism.
- `useMemo(terminalPrewarmRequest, [...])` in `ChatView.tsx` — recomputes the prewarm
  input whenever `threadId`, `terminalId`, `terminalOpen`, `cwd`, or `runtimeEnv` changes.
- A `useEffect` in `ChatView.browser.tsx` fires the `terminal.open` RPC with a
  `TERMINAL_PREWARM_DELAY_MS = 150` timeout when `terminalPrewarmRequest` is non-null.

**Why:** Terminal startup latency was noticeable (shell process + env init on first open).
Pre-warming in the background on thread switch makes the perceived latency ~zero while
adding negligible overhead for sessions where the terminal is never opened (the shell is
only started, not rendered).

**Files touched:**
- `apps/web/src/components/ChatView.logic.ts` — `buildTerminalPrewarmRequest` helper
- `apps/web/src/components/ChatView.logic.test.ts` — unit tests for prewarm logic
- `apps/web/src/components/ChatView.tsx` — `terminalPrewarmRequest` memo; imports helper
- `apps/web/src/components/ChatView.browser.tsx` — `useEffect` that fires the RPC

---

## Conflict Hot-Spots When Rebasing onto main

| File | Risk | Notes |
|---|---|---|
| `packages/shared/src/shell.ts` | **High** | New exports; conflicts if main adds to this file (inherited from `terminal-zshrc-fix`) |
| `apps/web/src/components/ChatView.tsx` | **High** | Significant additions to hook section and imports; main is actively developed here |
| `apps/web/src/components/ChatView.logic.ts` | Medium | New export appended at end of file; low risk unless main appends too |
| `apps/desktop/src/syncShellEnvironment.ts` | Medium | Gutted to re-export (inherited from `terminal-zshrc-fix`) |
| `apps/server/src/os-jank.ts` | Medium | Import change (inherited from `terminal-zshrc-fix`) |
| `apps/web/src/components/ChatView.browser.tsx` | Low-Med | New file; conflicts only if main creates a file at the same path |

**Resolution guidance:**

- **`ChatView.tsx`**: The prewarm memo lives between `gitCwd`/`activeThreadWorktreePath`
  derivation and the `isGitRepo` line. When rebasing, place `terminalPrewarmRequest` in the
  same logical position. The `buildTerminalPrewarmRequest` import must be added to the
  `ChatView.logic` import block.
- **`ChatView.logic.ts`**: `buildTerminalPrewarmRequest` is appended after
  `buildExpiredTerminalContextToastCopy`. If main adds exports after that function, merge
  the additions; the function itself is self-contained.
- **Shell files**: Same guidance as `terminal-zshrc-fix` — keep implementation in
  `packages/shared/src/shell.ts`, desktop file stays as a thin re-export.
