import { isMacPlatform } from "./lib/utils";

export type FileExplorerTabDirection = "previous" | "next";

export function openFileExplorerTab(
  tabs: readonly string[],
  path: string,
): { tabs: readonly string[]; activePath: string } {
  if (tabs.includes(path)) {
    return { tabs, activePath: path };
  }
  return { tabs: [...tabs, path], activePath: path };
}

export function closeFileExplorerTab(
  tabs: readonly string[],
  activePath: string | null,
  path: string,
): { tabs: readonly string[]; activePath: string | null } {
  const closingIndex = tabs.indexOf(path);
  if (closingIndex === -1) {
    return { tabs, activePath };
  }

  const nextTabs = tabs.filter((tab) => tab !== path);
  if (activePath !== path) {
    return { tabs: nextTabs, activePath };
  }

  return {
    tabs: nextTabs,
    activePath: nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? null,
  };
}

export function selectAdjacentFileExplorerTab(
  tabs: readonly string[],
  activePath: string | null,
  direction: FileExplorerTabDirection,
): string | null {
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return tabs[0] ?? null;

  const activeIndex = activePath ? tabs.indexOf(activePath) : -1;
  const startIndex = activeIndex === -1 ? 0 : activeIndex;
  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (startIndex + offset + tabs.length) % tabs.length;
  return tabs[nextIndex] ?? null;
}

export function fileExplorerTabDirectionFromShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): FileExplorerTabDirection | null {
  const key = event.key;
  if (key !== "[" && key !== "]") return null;
  if (event.altKey || event.shiftKey) return null;

  const isMac = isMacPlatform(platform);
  const expectedMeta = isMac;
  const expectedCtrl = !isMac;
  if (event.metaKey !== expectedMeta || event.ctrlKey !== expectedCtrl) {
    return null;
  }

  return key === "]" ? "next" : "previous";
}

export function isFileExplorerCloseTabShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  if (event.key.toLowerCase() !== "w") return false;
  if (event.altKey || event.shiftKey) return false;
  return event.metaKey || event.ctrlKey;
}
