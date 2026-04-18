# Branch: terminal-zshrc-fix

**Base:** `main`
**Commits:** 1

## Summary

Consolidates shell environment syncing into `packages/shared/src/shell.ts` (moving it out
of `apps/desktop`) and expands the list of macOS login-shell variables to include Homebrew
env vars (`HOMEBREW_PREFIX`, `HOMEBREW_CELLAR`, `HOMEBREW_REPOSITORY`).

---

## Changes

### 1. `fix(shell): consolidate env sync and expand list for homebrew vars` (`a532981`)

**What:**

1. **Moved `syncShellEnvironment` to shared package** — the function previously lived in
   `apps/desktop/src/syncShellEnvironment.ts`. It is now implemented in
   `packages/shared/src/shell.ts` and `apps/desktop/src/syncShellEnvironment.ts` is
   reduced to a single re-export: `export { syncShellEnvironment } from "@t3tools/shared/shell"`.

2. **Added Homebrew vars to the default env-name list** — introduced
   `DEFAULT_MACOS_LOGIN_SHELL_ENV_NAMES` constant in `packages/shared/src/shell.ts`:
   ```ts
   ["PATH", "SSH_AUTH_SOCK", "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "HOMEBREW_REPOSITORY"]
   ```
   The old implementation only captured `PATH` and `SSH_AUTH_SOCK`. Missing Homebrew vars
   caused tools installed via Homebrew to be unavailable inside the app-server shell.

3. **Made the env-name list configurable** — `syncShellEnvironment` now accepts an optional
   `names` option (`ReadonlyArray<string>`) so callers can override the default list.

4. **Reduced duplication in `apps/server/src/os-jank.ts`** — updated to use the shared
   implementation.

**Why:** Users on macOS with Homebrew-installed tooling (node, bun, git, etc.) reported
that the in-app terminal and codex app-server didn't inherit Homebrew's `PATH` prefix and
related vars. Root cause: the env-sync only captured `PATH` and `SSH_AUTH_SOCK`.
Consolidating into the shared package also eliminates the duplicate
`syncShellEnvironment` implementations that existed across desktop and server packages.

**Files touched:**
- `packages/shared/src/shell.ts` — added `syncShellEnvironment`, `DEFAULT_MACOS_LOGIN_SHELL_ENV_NAMES`
- `packages/shared/src/shell.test.ts` — tests for new function and expanded var list
- `apps/desktop/src/syncShellEnvironment.ts` — replaced implementation with re-export
- `apps/desktop/src/syncShellEnvironment.test.ts` — updated tests
- `apps/server/src/os-jank.ts` — switched to shared implementation

---

## Conflict Hot-Spots When Rebasing onto main

| File | Risk | Notes |
|---|---|---|
| `packages/shared/src/shell.ts` | **High** | New exports added; conflicts if main adds anything to this file |
| `apps/desktop/src/syncShellEnvironment.ts` | Medium | File was gutted to a single re-export; conflicts if main modifies its internals |
| `apps/server/src/os-jank.ts` | Medium | Import path changed; conflicts if main touches env-sync logic here |
| `packages/shared/src/shell.test.ts` | Low | Additive test cases |

**Resolution guidance:** If `syncShellEnvironment.ts` conflicts, the intent is for the
file to contain **only** `export { syncShellEnvironment } from "@t3tools/shared/shell"`.
Ensure the implementation stays in `packages/shared/src/shell.ts`. If `os-jank.ts`
conflicts, verify the import resolves to the shared package rather than the desktop path.

> **Note:** The single commit (`a532981`) on this branch is also the base commit of
> `terminal-perf-impr`. If both branches are being merged, apply this one first (or use
> `terminal-perf-impr` which is a strict superset).
