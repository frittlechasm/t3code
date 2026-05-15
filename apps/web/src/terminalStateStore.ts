/**
 * Single Zustand store for terminal UI state keyed by scoped thread identity.
 *
 * Terminal transition helpers are intentionally private to keep the public
 * API constrained to store actions/selectors.
 */

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime";
import { type ScopedThreadRef, type TerminalEvent } from "@t3tools/contracts";
import { DEFAULT_TERMINAL_PLACEMENT, type TerminalPlacement } from "@t3tools/contracts/settings";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getClientSettings } from "./hooks/useSettings";
import { resolveStorage } from "./lib/storage";
import { terminalRunningSubprocessFromEvent } from "./terminalActivity";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_WIDTH,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "./types";

interface ThreadTerminalState {
  terminalOpen: boolean;
  terminalPlacement: TerminalPlacement;
  terminalIds: string[];
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
}

export interface LogicalProjectTerminalDimensions {
  terminalHeight: number;
  terminalWidth: number;
}

export interface ThreadTerminalLaunchContext {
  cwd: string;
  worktreePath: string | null;
}

export interface TerminalEventEntry {
  id: number;
  event: TerminalEvent;
}

const TERMINAL_STATE_STORAGE_KEY = "t3code:terminal-state:v1";
const EMPTY_TERMINAL_EVENT_ENTRIES: ReadonlyArray<TerminalEventEntry> = [];
const MAX_TERMINAL_EVENT_BUFFER = 200;

interface PersistedTerminalStateStoreState {
  terminalStateByThreadKey?: Record<string, PersistedThreadTerminalState>;
  terminalDimensionsByLogicalProjectKey?: Record<string, PersistedLogicalProjectTerminalDimensions>;
}

type PersistedThreadTerminalState = Omit<ThreadTerminalState, "terminalPlacement"> & {
  terminalPlacement?: TerminalPlacement;
  terminalHeight?: number;
};

type PersistedLogicalProjectTerminalDimensions = Partial<LogicalProjectTerminalDimensions>;

export function migratePersistedTerminalStateStoreState(
  persistedState: unknown,
  version: number,
): PersistedTerminalStateStoreState {
  if (
    (version === 1 || version === 2 || version === 3) &&
    persistedState &&
    typeof persistedState === "object"
  ) {
    const candidate = persistedState as PersistedTerminalStateStoreState;
    const nextTerminalStateByThreadKey = Object.fromEntries(
      Object.entries(candidate.terminalStateByThreadKey ?? {}).filter(([threadKey]) =>
        parseScopedThreadKey(threadKey),
      ),
    );
    const nextTerminalDimensionsByLogicalProjectKey = Object.fromEntries(
      Object.entries(candidate.terminalDimensionsByLogicalProjectKey ?? {}).filter(
        ([logicalProjectKey]) => logicalProjectKey.trim().length > 0,
      ),
    );
    return {
      terminalStateByThreadKey: nextTerminalStateByThreadKey,
      terminalDimensionsByLogicalProjectKey: nextTerminalDimensionsByLogicalProjectKey,
    };
  }
  return { terminalStateByThreadKey: {}, terminalDimensionsByLogicalProjectKey: {} };
}

function createTerminalStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  const ids = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

function fallbackGroupId(terminalId: string): string {
  return `group-${terminalId}`;
}

function assignUniqueGroupId(baseId: string, usedGroupIds: Set<string>): string {
  let candidate = baseId;
  let index = 2;
  while (usedGroupIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  usedGroupIds.add(candidate);
  return candidate;
}

function findGroupIndexByTerminalId(
  terminalGroups: ThreadTerminalGroup[],
  terminalId: string,
): number {
  return terminalGroups.findIndex((group) => group.terminalIds.includes(terminalId));
}

function normalizeTerminalGroupIds(terminalIds: string[]): string[] {
  return [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
}

function normalizeTerminalGroups(
  terminalGroups: ThreadTerminalGroup[],
  terminalIds: string[],
): ThreadTerminalGroup[] {
  const validTerminalIdSet = new Set(terminalIds);
  const assignedTerminalIds = new Set<string>();
  const nextGroups: ThreadTerminalGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const group of terminalGroups) {
    const groupTerminalIds = normalizeTerminalGroupIds(group.terminalIds).filter((terminalId) => {
      if (!validTerminalIdSet.has(terminalId)) return false;
      if (assignedTerminalIds.has(terminalId)) return false;
      return true;
    });
    if (groupTerminalIds.length === 0) continue;
    for (const terminalId of groupTerminalIds) {
      assignedTerminalIds.add(terminalId);
    }
    const baseGroupId =
      group.id.trim().length > 0
        ? group.id.trim()
        : fallbackGroupId(groupTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
    nextGroups.push({
      id: assignUniqueGroupId(baseGroupId, usedGroupIds),
      terminalIds: groupTerminalIds,
    });
  }

  for (const terminalId of terminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextGroups.push({
      id: assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
      terminalIds: [terminalId],
    });
  }

  if (nextGroups.length === 0) {
    return [
      {
        id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      },
    ];
  }

  return nextGroups;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function terminalGroupsEqual(left: ThreadTerminalGroup[], right: ThreadTerminalGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftGroup = left[index];
    const rightGroup = right[index];
    if (!leftGroup || !rightGroup) return false;
    if (leftGroup.id !== rightGroup.id) return false;
    if (!arraysEqual(leftGroup.terminalIds, rightGroup.terminalIds)) return false;
  }
  return true;
}

function threadTerminalStateEqual(left: ThreadTerminalState, right: ThreadTerminalState): boolean {
  return (
    left.terminalOpen === right.terminalOpen &&
    left.terminalPlacement === right.terminalPlacement &&
    left.activeTerminalId === right.activeTerminalId &&
    left.activeTerminalGroupId === right.activeTerminalGroupId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds) &&
    terminalGroupsEqual(left.terminalGroups, right.terminalGroups)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: ThreadTerminalState = Object.freeze({
  terminalOpen: false,
  terminalPlacement: DEFAULT_TERMINAL_PLACEMENT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  runningTerminalIds: [],
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
  terminalGroups: [
    {
      id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
    },
  ],
  activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
});

const DEFAULT_TERMINAL_DIMENSIONS: LogicalProjectTerminalDimensions = Object.freeze({
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalWidth: DEFAULT_THREAD_TERMINAL_WIDTH,
});
const DEFAULT_THREAD_TERMINAL_STATE_BY_PLACEMENT = new Map<TerminalPlacement, ThreadTerminalState>([
  [DEFAULT_THREAD_TERMINAL_STATE.terminalPlacement, DEFAULT_THREAD_TERMINAL_STATE],
]);
const NORMALIZED_THREAD_TERMINAL_STATE_BY_SOURCE = new WeakMap<
  PersistedThreadTerminalState,
  ThreadTerminalState
>();

function createDefaultThreadTerminalState(
  terminalPlacement: TerminalPlacement = DEFAULT_TERMINAL_PLACEMENT,
): ThreadTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalPlacement,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
    terminalGroups: copyTerminalGroups(DEFAULT_THREAD_TERMINAL_STATE.terminalGroups),
  };
}

function getDefaultThreadTerminalState(
  terminalPlacement: TerminalPlacement = DEFAULT_TERMINAL_PLACEMENT,
): ThreadTerminalState {
  const cached = DEFAULT_THREAD_TERMINAL_STATE_BY_PLACEMENT.get(terminalPlacement);
  if (cached) {
    return cached;
  }
  const defaultState = createDefaultThreadTerminalState(terminalPlacement);
  DEFAULT_THREAD_TERMINAL_STATE_BY_PLACEMENT.set(terminalPlacement, defaultState);
  return defaultState;
}

function normalizeTerminalPlacement(placement: unknown): TerminalPlacement {
  return placement === "right" || placement === "bottom" ? placement : DEFAULT_TERMINAL_PLACEMENT;
}

function defaultTerminalPlacementFromSettings(): TerminalPlacement {
  return getClientSettings().defaultTerminalPlacement;
}

function normalizeThreadTerminalState(state: PersistedThreadTerminalState): ThreadTerminalState {
  const cached = NORMALIZED_THREAD_TERMINAL_STATE_BY_SOURCE.get(state);
  if (cached) {
    return cached;
  }
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds.length > 0 ? terminalIds : [DEFAULT_THREAD_TERMINAL_ID];
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalGroups = normalizeTerminalGroups(state.terminalGroups, nextTerminalIds);
  const activeGroupIdFromState = terminalGroups.some(
    (group) => group.id === state.activeTerminalGroupId,
  )
    ? state.activeTerminalGroupId
    : null;
  const activeGroupIdFromTerminal =
    terminalGroups.find((group) => group.terminalIds.includes(activeTerminalId))?.id ?? null;

  const normalized: ThreadTerminalState = {
    terminalOpen: state.terminalOpen,
    terminalPlacement: normalizeTerminalPlacement(state.terminalPlacement),
    terminalIds: nextTerminalIds,
    runningTerminalIds,
    activeTerminalId,
    terminalGroups,
    activeTerminalGroupId:
      activeGroupIdFromState ??
      activeGroupIdFromTerminal ??
      terminalGroups[0]?.id ??
      fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
  };
  const result =
    state.terminalPlacement !== undefined &&
    threadTerminalStateEqual(state as ThreadTerminalState, normalized)
      ? (state as ThreadTerminalState)
      : normalized;
  NORMALIZED_THREAD_TERMINAL_STATE_BY_SOURCE.set(state, result);
  return result;
}

function isDefaultThreadTerminalState(
  state: ThreadTerminalState,
  defaultTerminalPlacement: TerminalPlacement = DEFAULT_TERMINAL_PLACEMENT,
): boolean {
  const normalized = normalizeThreadTerminalState(state);
  return threadTerminalStateEqual(
    normalized,
    getDefaultThreadTerminalState(defaultTerminalPlacement),
  );
}

function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}

function logicalProjectTerminalDimensionsKey(logicalProjectKey: string): string {
  return logicalProjectKey.trim();
}

function terminalThreadKey(threadRef: ScopedThreadRef): string {
  return scopedThreadKey(threadRef);
}

function terminalEventBufferKey(threadRef: ScopedThreadRef, terminalId: string): string {
  return `${terminalThreadKey(threadRef)}\u0000${terminalId}`;
}

function copyTerminalGroups(groups: ThreadTerminalGroup[]): ThreadTerminalGroup[] {
  return groups.map((group) => ({
    id: group.id,
    terminalIds: [...group.terminalIds],
  }));
}

function appendTerminalEventEntry(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  nextTerminalEventId: number,
  threadRef: ScopedThreadRef,
  event: TerminalEvent,
) {
  const key = terminalEventBufferKey(threadRef, event.terminalId);
  const currentEntries = terminalEventEntriesByKey[key] ?? EMPTY_TERMINAL_EVENT_ENTRIES;
  const nextEntry: TerminalEventEntry = {
    id: nextTerminalEventId,
    event,
  };
  const nextEntries =
    currentEntries.length >= MAX_TERMINAL_EVENT_BUFFER
      ? [...currentEntries.slice(1), nextEntry]
      : [...currentEntries, nextEntry];

  return {
    terminalEventEntriesByKey: {
      ...terminalEventEntriesByKey,
      [key]: nextEntries,
    },
    nextTerminalEventId: nextTerminalEventId + 1,
  };
}

function launchContextFromStartEvent(
  event: Extract<TerminalEvent, { type: "started" | "restarted" }>,
): ThreadTerminalLaunchContext {
  return {
    cwd: event.snapshot.cwd,
    worktreePath: event.snapshot.worktreePath,
  };
}

function upsertTerminalIntoGroups(
  state: ThreadTerminalState,
  terminalId: string,
  mode: "split" | "new",
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId)) {
    return normalized;
  }

  const isNewTerminal = !normalized.terminalIds.includes(terminalId);
  const terminalIds = isNewTerminal
    ? [...normalized.terminalIds, terminalId]
    : normalized.terminalIds;
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);

  const existingGroupIndex = findGroupIndexByTerminalId(terminalGroups, terminalId);
  if (existingGroupIndex >= 0) {
    terminalGroups[existingGroupIndex]!.terminalIds = terminalGroups[
      existingGroupIndex
    ]!.terminalIds.filter((id) => id !== terminalId);
    if (terminalGroups[existingGroupIndex]!.terminalIds.length === 0) {
      terminalGroups.splice(existingGroupIndex, 1);
    }
  }

  if (mode === "new") {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds);
    terminalGroups.push({ id: nextGroupId, terminalIds: [terminalId] });
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds,
      activeTerminalId: terminalId,
      terminalGroups,
      activeTerminalGroupId: nextGroupId,
    });
  }

  let activeGroupIndex = terminalGroups.findIndex(
    (group) => group.id === normalized.activeTerminalGroupId,
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(
      fallbackGroupId(normalized.activeTerminalId),
      usedGroupIds,
    );
    terminalGroups.push({ id: nextGroupId, terminalIds: [normalized.activeTerminalId] });
    activeGroupIndex = terminalGroups.length - 1;
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }

  if (
    isNewTerminal &&
    !destinationGroup.terminalIds.includes(terminalId) &&
    destinationGroup.terminalIds.length >= MAX_TERMINALS_PER_GROUP
  ) {
    return normalized;
  }

  if (!destinationGroup.terminalIds.includes(terminalId)) {
    const anchorIndex = destinationGroup.terminalIds.indexOf(normalized.activeTerminalId);
    if (anchorIndex >= 0) {
      destinationGroup.terminalIds.splice(anchorIndex + 1, 0, terminalId);
    } else {
      destinationGroup.terminalIds.push(terminalId);
    }
  }

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: destinationGroup.id,
  });
}

function setThreadTerminalOpen(state: ThreadTerminalState, open: boolean): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.terminalOpen === open) return normalized;
  return { ...normalized, terminalOpen: open };
}

function setThreadTerminalPlacement(
  state: ThreadTerminalState,
  placement: TerminalPlacement,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.terminalPlacement === placement) return normalized;
  return { ...normalized, terminalPlacement: placement };
}

function toggleThreadTerminalPlacement(state: ThreadTerminalState): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  return {
    ...normalized,
    terminalPlacement: normalized.terminalPlacement === "bottom" ? "right" : "bottom",
  };
}

function splitThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split");
}

function newThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "new");
}

function setThreadActiveTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const activeTerminalGroupId =
    normalized.terminalGroups.find((group) => group.terminalIds.includes(terminalId))?.id ??
    normalized.activeTerminalGroupId;
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.activeTerminalGroupId === activeTerminalGroupId
  ) {
    return normalized;
  }
  return {
    ...normalized,
    activeTerminalId: terminalId,
    activeTerminalGroupId,
  };
}

function closeThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    return createDefaultThreadTerminalState(normalized.terminalPlacement);
  }

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        remainingTerminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;

  const terminalGroups = normalized.terminalGroups
    .map((group) => ({
      ...group,
      terminalIds: group.terminalIds.filter((id) => id !== terminalId),
    }))
    .filter((group) => group.terminalIds.length > 0);

  const nextActiveTerminalGroupId =
    terminalGroups.find((group) => group.terminalIds.includes(nextActiveTerminalId))?.id ??
    terminalGroups[0]?.id ??
    fallbackGroupId(nextActiveTerminalId);

  return normalizeThreadTerminalState({
    terminalOpen: normalized.terminalOpen,
    terminalPlacement: normalized.terminalPlacement,
    terminalIds: remainingTerminalIds,
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    activeTerminalId: nextActiveTerminalId,
    terminalGroups,
    activeTerminalGroupId: nextActiveTerminalGroupId,
  });
}

function normalizeTerminalDimension(value: unknown, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0 ? value : fallback;
}

function normalizeLogicalProjectTerminalDimensions(
  dimensions: PersistedLogicalProjectTerminalDimensions | undefined,
  fallbackHeight: number = DEFAULT_THREAD_TERMINAL_HEIGHT,
): LogicalProjectTerminalDimensions {
  return {
    terminalHeight: normalizeTerminalDimension(dimensions?.terminalHeight, fallbackHeight),
    terminalWidth: normalizeTerminalDimension(
      dimensions?.terminalWidth,
      DEFAULT_THREAD_TERMINAL_WIDTH,
    ),
  };
}

function logicalProjectTerminalDimensionsEqual(
  left: LogicalProjectTerminalDimensions,
  right: LogicalProjectTerminalDimensions,
): boolean {
  return left.terminalHeight === right.terminalHeight && left.terminalWidth === right.terminalWidth;
}

function legacyTerminalHeightForThread(
  terminalStateByThreadKey: Record<string, PersistedThreadTerminalState>,
  threadRef: ScopedThreadRef | null | undefined,
): number | undefined {
  if (!threadRef || threadRef.threadId.length === 0) {
    return undefined;
  }
  const legacyHeight = terminalStateByThreadKey[terminalThreadKey(threadRef)]?.terminalHeight;
  return Number.isFinite(legacyHeight) && typeof legacyHeight === "number" && legacyHeight > 0
    ? legacyHeight
    : undefined;
}

function setThreadTerminalActivity(
  state: ThreadTerminalState,
  terminalId: string,
  hasRunningSubprocess: boolean,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  if (hasRunningSubprocess === alreadyRunning) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  return { ...normalized, runningTerminalIds: [...runningTerminalIds] };
}

export function selectThreadTerminalState(
  terminalStateByThreadKey: Record<string, PersistedThreadTerminalState>,
  threadRef: ScopedThreadRef | null | undefined,
  defaultTerminalPlacement: TerminalPlacement = defaultTerminalPlacementFromSettings(),
): ThreadTerminalState {
  if (!threadRef || threadRef.threadId.length === 0) {
    return getDefaultThreadTerminalState(defaultTerminalPlacement);
  }
  const persisted = terminalStateByThreadKey[terminalThreadKey(threadRef)];
  return persisted
    ? normalizeThreadTerminalState(persisted)
    : getDefaultThreadTerminalState(defaultTerminalPlacement);
}

export function selectLogicalProjectTerminalDimensions(
  terminalDimensionsByLogicalProjectKey: Record<string, PersistedLogicalProjectTerminalDimensions>,
  logicalProjectKey: string | null | undefined,
  options?: {
    terminalStateByThreadKey?: Record<string, PersistedThreadTerminalState>;
    threadRef?: ScopedThreadRef | null | undefined;
  },
): LogicalProjectTerminalDimensions {
  const fallbackHeight =
    legacyTerminalHeightForThread(options?.terminalStateByThreadKey ?? {}, options?.threadRef) ??
    DEFAULT_THREAD_TERMINAL_HEIGHT;
  const normalizedLogicalProjectKey =
    typeof logicalProjectKey === "string"
      ? logicalProjectTerminalDimensionsKey(logicalProjectKey)
      : "";
  if (normalizedLogicalProjectKey.length === 0) {
    return normalizeLogicalProjectTerminalDimensions(undefined, fallbackHeight);
  }
  return normalizeLogicalProjectTerminalDimensions(
    terminalDimensionsByLogicalProjectKey[normalizedLogicalProjectKey],
    fallbackHeight,
  );
}

function updateTerminalStateByThreadKey(
  terminalStateByThreadKey: Record<string, PersistedThreadTerminalState>,
  threadRef: ScopedThreadRef,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
): Record<string, PersistedThreadTerminalState> {
  if (threadRef.threadId.length === 0) {
    return terminalStateByThreadKey;
  }

  const threadKey = terminalThreadKey(threadRef);
  const defaultTerminalPlacement = defaultTerminalPlacementFromSettings();
  const current = selectThreadTerminalState(
    terminalStateByThreadKey,
    threadRef,
    defaultTerminalPlacement,
  );
  const next = updater(current);
  if (next === current) {
    return terminalStateByThreadKey;
  }

  if (isDefaultThreadTerminalState(next, defaultTerminalPlacement)) {
    if (terminalStateByThreadKey[threadKey] === undefined) {
      return terminalStateByThreadKey;
    }
    const { [threadKey]: _removed, ...rest } = terminalStateByThreadKey;
    return rest;
  }

  return {
    ...terminalStateByThreadKey,
    [threadKey]: next,
  };
}

export function selectTerminalEventEntries(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  threadRef: ScopedThreadRef | null | undefined,
  terminalId: string,
): ReadonlyArray<TerminalEventEntry> {
  if (!threadRef || threadRef.threadId.length === 0 || terminalId.trim().length === 0) {
    return EMPTY_TERMINAL_EVENT_ENTRIES;
  }
  return (
    terminalEventEntriesByKey[terminalEventBufferKey(threadRef, terminalId)] ??
    EMPTY_TERMINAL_EVENT_ENTRIES
  );
}

interface TerminalStateStoreState {
  terminalStateByThreadKey: Record<string, PersistedThreadTerminalState>;
  terminalDimensionsByLogicalProjectKey: Record<string, PersistedLogicalProjectTerminalDimensions>;
  terminalLaunchContextByThreadKey: Record<string, ThreadTerminalLaunchContext>;
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>;
  nextTerminalEventId: number;
  setTerminalOpen: (threadRef: ScopedThreadRef, open: boolean) => void;
  setTerminalPlacement: (threadRef: ScopedThreadRef, placement: TerminalPlacement) => void;
  toggleTerminalPlacement: (threadRef: ScopedThreadRef) => void;
  setTerminalHeight: (logicalProjectKey: string, height: number) => void;
  setTerminalWidth: (logicalProjectKey: string, width: number) => void;
  splitTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  newTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  ensureTerminal: (
    threadRef: ScopedThreadRef,
    terminalId: string,
    options?: { open?: boolean; active?: boolean },
  ) => void;
  setActiveTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  closeTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  setTerminalLaunchContext: (
    threadRef: ScopedThreadRef,
    context: ThreadTerminalLaunchContext,
  ) => void;
  clearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
  setTerminalActivity: (
    threadRef: ScopedThreadRef,
    terminalId: string,
    hasRunningSubprocess: boolean,
  ) => void;
  recordTerminalEvent: (threadRef: ScopedThreadRef, event: TerminalEvent) => void;
  applyTerminalEvent: (threadRef: ScopedThreadRef, event: TerminalEvent) => void;
  clearTerminalState: (threadRef: ScopedThreadRef) => void;
  removeTerminalState: (threadRef: ScopedThreadRef) => void;
  removeOrphanedTerminalStates: (activeThreadKeys: Set<string>) => void;
}

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        threadRef: ScopedThreadRef,
        updater: (state: ThreadTerminalState) => ThreadTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
            state.terminalStateByThreadKey,
            threadRef,
            updater,
          );
          if (nextTerminalStateByThreadKey === state.terminalStateByThreadKey) {
            return state;
          }
          return {
            terminalStateByThreadKey: nextTerminalStateByThreadKey,
          };
        });
      };
      const updateTerminalDimensions = (
        logicalProjectKey: string,
        updater: (dimensions: LogicalProjectTerminalDimensions) => LogicalProjectTerminalDimensions,
      ) => {
        set((state) => {
          const dimensionKey = logicalProjectTerminalDimensionsKey(logicalProjectKey);
          if (dimensionKey.length === 0) {
            return state;
          }
          const current = selectLogicalProjectTerminalDimensions(
            state.terminalDimensionsByLogicalProjectKey,
            dimensionKey,
          );
          const next = updater(current);
          if (
            next === current ||
            logicalProjectTerminalDimensionsEqual(current, next) ||
            logicalProjectTerminalDimensionsEqual(next, DEFAULT_TERMINAL_DIMENSIONS)
          ) {
            if (
              logicalProjectTerminalDimensionsEqual(next, DEFAULT_TERMINAL_DIMENSIONS) &&
              state.terminalDimensionsByLogicalProjectKey[dimensionKey] !== undefined
            ) {
              const { [dimensionKey]: _removed, ...rest } =
                state.terminalDimensionsByLogicalProjectKey;
              return { terminalDimensionsByLogicalProjectKey: rest };
            }
            return state;
          }
          return {
            terminalDimensionsByLogicalProjectKey: {
              ...state.terminalDimensionsByLogicalProjectKey,
              [dimensionKey]: next,
            },
          };
        });
      };

      return {
        terminalStateByThreadKey: {},
        terminalDimensionsByLogicalProjectKey: {},
        terminalLaunchContextByThreadKey: {},
        terminalEventEntriesByKey: {},
        nextTerminalEventId: 1,
        setTerminalOpen: (threadRef, open) =>
          updateTerminal(threadRef, (state) => setThreadTerminalOpen(state, open)),
        setTerminalPlacement: (threadRef, placement) =>
          updateTerminal(threadRef, (state) => setThreadTerminalPlacement(state, placement)),
        toggleTerminalPlacement: (threadRef) =>
          updateTerminal(threadRef, (state) => toggleThreadTerminalPlacement(state)),
        setTerminalHeight: (logicalProjectKey, height) =>
          updateTerminalDimensions(logicalProjectKey, (dimensions) => {
            const terminalHeight = normalizeTerminalDimension(height, dimensions.terminalHeight);
            return terminalHeight === dimensions.terminalHeight
              ? dimensions
              : { ...dimensions, terminalHeight };
          }),
        setTerminalWidth: (logicalProjectKey, width) =>
          updateTerminalDimensions(logicalProjectKey, (dimensions) => {
            const terminalWidth = normalizeTerminalDimension(width, dimensions.terminalWidth);
            return terminalWidth === dimensions.terminalWidth
              ? dimensions
              : { ...dimensions, terminalWidth };
          }),
        splitTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => splitThreadTerminal(state, terminalId)),
        newTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => newThreadTerminal(state, terminalId)),
        ensureTerminal: (threadRef, terminalId, options) =>
          updateTerminal(threadRef, (state) => {
            let nextState = state;
            if (!state.terminalIds.includes(terminalId)) {
              nextState = newThreadTerminal(nextState, terminalId);
            }
            if (options?.active === false) {
              nextState = {
                ...nextState,
                activeTerminalId: state.activeTerminalId,
                activeTerminalGroupId: state.activeTerminalGroupId,
              };
            }
            if (options?.active ?? true) {
              nextState = setThreadActiveTerminal(nextState, terminalId);
            }
            if (options?.open) {
              nextState = setThreadTerminalOpen(nextState, true);
            }
            return normalizeThreadTerminalState(nextState);
          }),
        setActiveTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => closeThreadTerminal(state, terminalId)),
        setTerminalLaunchContext: (threadRef, context) =>
          set((state) => ({
            terminalLaunchContextByThreadKey: {
              ...state.terminalLaunchContextByThreadKey,
              [terminalThreadKey(threadRef)]: context,
            },
          })),
        clearTerminalLaunchContext: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            if (!state.terminalLaunchContextByThreadKey[threadKey]) {
              return state;
            }
            const { [threadKey]: _removed, ...rest } = state.terminalLaunchContextByThreadKey;
            return { terminalLaunchContextByThreadKey: rest };
          }),
        setTerminalActivity: (threadRef, terminalId, hasRunningSubprocess) =>
          updateTerminal(threadRef, (state) =>
            setThreadTerminalActivity(state, terminalId, hasRunningSubprocess),
          ),
        recordTerminalEvent: (threadRef, event) =>
          set((state) =>
            appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              threadRef,
              event,
            ),
          ),
        applyTerminalEvent: (threadRef, event) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            let nextTerminalStateByThreadKey = state.terminalStateByThreadKey;
            let nextTerminalLaunchContextByThreadKey = state.terminalLaunchContextByThreadKey;

            if (event.type === "started" || event.type === "restarted") {
              nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
                nextTerminalStateByThreadKey,
                threadRef,
                (current) => {
                  let nextState = current;
                  if (!current.terminalIds.includes(event.terminalId)) {
                    nextState = newThreadTerminal(nextState, event.terminalId);
                  }
                  nextState = setThreadActiveTerminal(nextState, event.terminalId);
                  nextState = setThreadTerminalOpen(nextState, true);
                  return normalizeThreadTerminalState(nextState);
                },
              );
              nextTerminalLaunchContextByThreadKey = {
                ...nextTerminalLaunchContextByThreadKey,
                [threadKey]: launchContextFromStartEvent(event),
              };
            }

            const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
            if (hasRunningSubprocess !== null) {
              nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
                nextTerminalStateByThreadKey,
                threadRef,
                (current) =>
                  setThreadTerminalActivity(current, event.terminalId, hasRunningSubprocess),
              );
            }

            const nextEventState = appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              threadRef,
              event,
            );

            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextTerminalLaunchContextByThreadKey,
              ...nextEventState,
            };
          }),
        clearTerminalState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            const nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
              state.terminalStateByThreadKey,
              threadRef,
              () => createDefaultThreadTerminalState(defaultTerminalPlacementFromSettings()),
            );
            const hadLaunchContext =
              state.terminalLaunchContextByThreadKey[threadKey] !== undefined;
            const { [threadKey]: _removed, ...remainingLaunchContexts } =
              state.terminalLaunchContextByThreadKey;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${threadKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              nextTerminalStateByThreadKey === state.terminalStateByThreadKey &&
              !hadLaunchContext &&
              !removedEventEntries
            ) {
              return state;
            }
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: remainingLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeTerminalState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            const hadTerminalState = state.terminalStateByThreadKey[threadKey] !== undefined;
            const hadLaunchContext =
              state.terminalLaunchContextByThreadKey[threadKey] !== undefined;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${threadKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (!hadTerminalState && !hadLaunchContext && !removedEventEntries) {
              return state;
            }
            const nextTerminalStateByThreadKey = { ...state.terminalStateByThreadKey };
            delete nextTerminalStateByThreadKey[threadKey];
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            delete nextLaunchContexts[threadKey];
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeOrphanedTerminalStates: (activeThreadKeys) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateByThreadKey).filter(
              (key) => !activeThreadKeys.has(key),
            );
            const orphanedLaunchContextIds = Object.keys(
              state.terminalLaunchContextByThreadKey,
            ).filter((key) => !activeThreadKeys.has(key));
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              const [threadKey] = key.split("\u0000");
              if (threadKey && !activeThreadKeys.has(threadKey)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              orphanedIds.length === 0 &&
              orphanedLaunchContextIds.length === 0 &&
              !removedEventEntries
            ) {
              return state;
            }
            const next = { ...state.terminalStateByThreadKey };
            for (const id of orphanedIds) {
              delete next[id];
            }
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            for (const id of orphanedLaunchContextIds) {
              delete nextLaunchContexts[id];
            }
            return {
              terminalStateByThreadKey: next,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(createTerminalStateStorage),
      migrate: migratePersistedTerminalStateStoreState,
      partialize: (state) => ({
        terminalStateByThreadKey: state.terminalStateByThreadKey,
        terminalDimensionsByLogicalProjectKey: state.terminalDimensionsByLogicalProjectKey,
      }),
    },
  ),
);
