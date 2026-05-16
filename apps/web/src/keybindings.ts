import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ResolvedKeybindingsConfig,
  TERMINAL_TAB_JUMP_KEYBINDING_COMMANDS,
  type TerminalTabJumpKeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ThreadJumpKeybindingCommand,
} from "@t3tools/contracts";
import { isMacPlatform } from "./lib/utils";

export interface ShortcutEventLike {
  type?: string;
  code?: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutModifierStateLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  [key: string]: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

interface EffectiveShortcutLookup {
  readonly commandByShortcutKey: ReadonlyMap<string, KeybindingCommand>;
  readonly shortcutByCommand: ReadonlyMap<KeybindingCommand, KeybindingShortcut>;
}

export type TerminalShortcutAction =
  | "toggle"
  | "togglePlacement"
  | "split"
  | "splitHorizontal"
  | "new"
  | "close"
  | "tabPrevious"
  | "tabNext"
  | "splitFocusNext"
  | "pinDrawer";

const TERMINAL_WORD_BACKWARD = "\u001bb";
const TERMINAL_WORD_FORWARD = "\u001bf";
const TERMINAL_LINE_START = "\u0001";
const TERMINAL_LINE_END = "\u0005";
const TERMINAL_DELETE_TO_LINE_START = "\u0015";
const EVENT_CODE_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BracketLeft: ["["],
  BracketRight: ["]"],
  Digit0: ["0"],
  Digit1: ["1"],
  Digit2: ["2"],
  Digit3: ["3"],
  Digit4: ["4"],
  Digit5: ["5"],
  Digit6: ["6"],
  Digit7: ["7"],
  Digit8: ["8"],
  Digit9: ["9"],
};

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "esc") return "escape";
  return normalized;
}

function resolveEventKeys(event: ShortcutEventLike): Set<string> {
  const keys = new Set([normalizeEventKey(event.key)]);
  const aliases = event.code ? EVENT_CODE_KEY_ALIASES[event.code] : undefined;
  if (!aliases) return keys;

  for (const alias of aliases) {
    keys.add(alias);
  }
  return keys;
}

function matchesShortcutModifiers(
  event: ShortcutModifierStateLike,
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): boolean {
  const useMetaForMod = isMacPlatform(platform);
  const expectedMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const expectedCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === shortcut.shiftKey &&
    event.altKey === shortcut.altKey
  );
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    ...options?.context,
  };
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhenNode(node.node, context);
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context);
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context);
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true;
  return evaluateWhenNode(whenAst, context);
}

function shortcutConflictKey(shortcut: KeybindingShortcut, platform = navigator.platform): string {
  const useMetaForMod = isMacPlatform(platform);
  const metaKey = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);

  return shortcutLookupKey({
    key: shortcut.key,
    metaKey,
    ctrlKey,
    shiftKey: shortcut.shiftKey,
    altKey: shortcut.altKey,
  });
}

function shortcutLookupKey(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string {
  return [
    input.key,
    input.metaKey ? "meta" : "",
    input.ctrlKey ? "ctrl" : "",
    input.shiftKey ? "shift" : "",
    input.altKey ? "alt" : "",
  ].join("|");
}

function eventShortcutLookupKeys(event: ShortcutEventLike): string[] {
  return [...resolveEventKeys(event)].map((key) =>
    shortcutLookupKey({
      key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }),
  );
}

const effectiveShortcutLookupCache = new WeakMap<
  ResolvedKeybindingsConfig,
  Map<string, EffectiveShortcutLookup>
>();

function contextCacheKey(context: ShortcutMatchContext): string {
  return Object.keys(context)
    .toSorted()
    .map((key) => `${key}:${context[key] ? "1" : "0"}`)
    .join(",");
}

function effectiveShortcutLookupCacheKey(platform: string, context: ShortcutMatchContext): string {
  return `${isMacPlatform(platform) ? "mac" : "nonmac"}\u0000${contextCacheKey(context)}`;
}

function compileEffectiveShortcutLookup(
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
  context: ShortcutMatchContext,
): EffectiveShortcutLookup {
  const commandByShortcutKey = new Map<string, KeybindingCommand>();
  const shortcutByCommand = new Map<KeybindingCommand, KeybindingShortcut>();

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;

    const conflictKey = shortcutConflictKey(binding.shortcut, platform);
    if (commandByShortcutKey.has(conflictKey)) {
      continue;
    }

    commandByShortcutKey.set(conflictKey, binding.command);
    if (!shortcutByCommand.has(binding.command)) {
      shortcutByCommand.set(binding.command, binding.shortcut);
    }
  }

  return { commandByShortcutKey, shortcutByCommand };
}

function getEffectiveShortcutLookup(
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): EffectiveShortcutLookup {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const cacheKey = effectiveShortcutLookupCacheKey(platform, context);
  let platformCache = effectiveShortcutLookupCache.get(keybindings);
  if (!platformCache) {
    platformCache = new Map();
    effectiveShortcutLookupCache.set(keybindings, platformCache);
  }

  const cached = platformCache.get(cacheKey);
  if (cached) return cached;

  const lookup = compileEffectiveShortcutLookup(keybindings, platform, context);
  platformCache.set(cacheKey, lookup);
  return lookup;
}

function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut | null {
  return getEffectiveShortcutLookup(keybindings, options).shortcutByCommand.get(command) ?? null;
}

function matchesCommandShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): boolean {
  return resolveShortcutCommand(event, keybindings, options) === command;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const lookup = getEffectiveShortcutLookup(keybindings, options);

  for (const lookupKey of eventShortcutLookupKeys(event)) {
    const command = lookup.commandByShortcutKey.get(lookupKey);
    if (command) return command;
  }
  return null;
}

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  const showAlt = shortcut.altKey;
  const showShift = shortcut.shiftKey;

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: string | ResolvedShortcutLabelOptions,
): string | null {
  const resolvedOptions =
    typeof options === "string"
      ? ({ platform: options } satisfies ResolvedShortcutLabelOptions)
      : options;
  const platform = resolvePlatform(resolvedOptions);
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, resolvedOptions);
  return shortcut ? formatShortcutLabel(shortcut, platform) : null;
}

export function threadJumpCommandForIndex(index: number): ThreadJumpKeybindingCommand | null {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function threadJumpIndexFromCommand(command: string): number | null {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.indexOf(command as ThreadJumpKeybindingCommand);
  return index === -1 ? null : index;
}

export function threadTraversalDirectionFromCommand(
  command: string | null,
): "previous" | "next" | null {
  if (command === "thread.previous") return "previous";
  if (command === "thread.next") return "next";
  return null;
}

export function shouldShowThreadJumpHints(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowThreadJumpHintsForModifiers(event, keybindings, options);
}

export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);
    if (!shortcut) continue;
    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.indexOf(
    command as ModelPickerJumpKeybindingCommand,
  );
  return index === -1 ? null : index;
}

export function terminalTabJumpCommandForIndex(
  index: number,
): TerminalTabJumpKeybindingCommand | null {
  return TERMINAL_TAB_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function terminalTabJumpIndexFromCommand(command: string): number | null {
  const index = TERMINAL_TAB_JUMP_KEYBINDING_COMMANDS.indexOf(
    command as TerminalTabJumpKeybindingCommand,
  );
  return index === -1 ? null : index;
}

export function resolveTerminalTabJumpIndex(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): number | null {
  const command = resolveShortcutCommand(event, keybindings, options);
  return command ? terminalTabJumpIndexFromCommand(command) : null;
}

export function shouldShowModelPickerJumpHints(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowModelPickerJumpHintsForModifiers(event, keybindings, options);
}

export function shouldShowModelPickerJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of MODEL_PICKER_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);
    if (!shortcut) continue;
    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function isTerminalToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.toggle", options);
}

export function isTerminalTogglePlacementShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.togglePlacement", options);
}

export function isTerminalSplitShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.split", options);
}

export function isTerminalNewShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.new", options);
}

export function isTerminalCloseShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.close", options);
}

export function isTerminalTabPreviousShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.tabPrevious", options);
}

export function isTerminalTabNextShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.tabNext", options);
}

export function isDiffToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "diff.toggle", options);
}

export function isFileExplorerToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "fileExplorer.toggle", options);
}

export function isFileExplorerToggleShortcutWithLegacyTerminalFocus(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  if (isFileExplorerToggleShortcut(event, keybindings, options)) {
    return true;
  }

  const context = resolveContext(options);
  if (!context.terminalFocus) {
    return false;
  }

  return isFileExplorerToggleShortcut(event, keybindings, {
    ...options,
    context: {
      ...context,
      terminalFocus: false,
    },
  });
}

export function isFileExplorerToggleTreeShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "fileExplorer.toggleTree", options);
}

export function isFileExplorerFocusSearchShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "fileExplorer.focusSearch", options);
}

export function isTaskWindowToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "taskWindow.toggle", options);
}

export function isChatNewShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "chat.new", options);
}

export function isChatNewLocalShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "chat.newLocal", options);
}

export function isOpenFavoriteEditorShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "editor.openFavorite", options);
}

export function terminalShortcutActionFromCommand(
  command: string | null,
): TerminalShortcutAction | null {
  switch (command) {
    case "terminal.toggle":
      return "toggle";
    case "terminal.togglePlacement":
      return "togglePlacement";
    case "terminal.split":
      return "split";
    case "terminal.splitHorizontal":
      return "splitHorizontal";
    case "terminal.new":
      return "new";
    case "terminal.close":
      return "close";
    case "terminal.tabPrevious":
      return "tabPrevious";
    case "terminal.tabNext":
      return "tabNext";
    case "terminal.splitFocusNext":
      return "splitFocusNext";
    case "terminal.pinDrawer":
      return "pinDrawer";
    default:
      return null;
  }
}

export function isTerminalClearShortcut(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();

  if (key === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return true;
  }

  return (
    isMacPlatform(platform) &&
    key === "k" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function isNativeTerminalNewTabShortcut(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = normalizeEventKey(event.key);
  const useMeta = isMacPlatform(platform);
  return (
    key === "t" &&
    event.metaKey === useMeta &&
    event.ctrlKey === !useMeta &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function nativeTerminalTabTraversalDirection(
  event: ShortcutEventLike,
  platform = navigator.platform,
): "previous" | "next" | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  const keys = resolveEventKeys(event);
  const useMeta = isMacPlatform(platform);
  if (event.metaKey !== useMeta || event.ctrlKey !== !useMeta || event.shiftKey || event.altKey) {
    return null;
  }

  if (keys.has("[")) return "previous";
  if (keys.has("]")) return "next";
  return null;
}

export function nativeTerminalShortcutAction(
  event: ShortcutEventLike,
  platform = navigator.platform,
): TerminalShortcutAction | null {
  if (isNativeTerminalNewTabShortcut(event, platform)) return "new";
  const direction = nativeTerminalTabTraversalDirection(event, platform);
  if (direction === "previous") return "tabPrevious";
  if (direction === "next") return "tabNext";
  return null;
}

export function resolveTerminalShortcutAction(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): TerminalShortcutAction | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  if (context.terminalFocus) {
    const nativeAction = nativeTerminalShortcutAction(event, platform);
    if (nativeAction !== null) return nativeAction;
  }

  return terminalShortcutActionFromCommand(
    resolveShortcutCommand(event, keybindings, { platform, context }),
  );
}

export function terminalDeleteShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (!isMacPlatform(platform)) {
    return null;
  }

  const key = normalizeEventKey(event.key);
  if (key !== "backspace") {
    return null;
  }

  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    ? TERMINAL_DELETE_TO_LINE_START
    : null;
}

export function terminalNavigationShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (event.shiftKey) return null;

  const key = normalizeEventKey(event.key);
  if (key !== "arrowleft" && key !== "arrowright") {
    return null;
  }

  const moveWord = key === "arrowleft" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
  const moveLine = key === "arrowleft" ? TERMINAL_LINE_START : TERMINAL_LINE_END;

  if (isMacPlatform(platform)) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      return moveWord;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      return moveLine;
    }
    return null;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    return moveWord;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    return moveWord;
  }

  return null;
}
