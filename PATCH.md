# Patch Summary

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
