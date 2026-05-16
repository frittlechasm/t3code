import { describe, expect, it } from "vitest";

import {
  resolveTerminalSelectionActionPosition,
  resolveThreadTerminalDrawerLayout,
  selectPendingTerminalEventEntries,
  selectTerminalEventEntriesAfterSnapshot,
  shouldHandleTerminalSelectionMouseUp,
  terminalSelectionActionDelayForClickCount,
} from "./ThreadTerminalDrawer";

describe("resolveTerminalSelectionActionPosition", () => {
  it("prefers the selection rect over the last pointer position", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: { right: 260, bottom: 140 },
        pointer: { x: 520, y: 200 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 260,
      y: 144,
    });
  });

  it("falls back to the pointer position when no selection rect is available", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 180, y: 130 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 180,
      y: 130,
    });
  });

  it("clamps the pointer fallback into the terminal drawer bounds", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 720, y: 340 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 600,
      y: 270,
    });

    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 40, y: 20 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("delays multi-click selection actions so triple-click selection can complete", () => {
    expect(terminalSelectionActionDelayForClickCount(1)).toBe(0);
    expect(terminalSelectionActionDelayForClickCount(2)).toBe(260);
    expect(terminalSelectionActionDelayForClickCount(3)).toBe(260);
  });

  it("only handles mouseup when the selection gesture started in the terminal", () => {
    expect(shouldHandleTerminalSelectionMouseUp(true, 0)).toBe(true);
    expect(shouldHandleTerminalSelectionMouseUp(false, 0)).toBe(false);
    expect(shouldHandleTerminalSelectionMouseUp(true, 1)).toBe(false);
  });

  it("replays only terminal events newer than the open snapshot", () => {
    expect(
      selectTerminalEventEntriesAfterSnapshot(
        [
          {
            id: 1,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:00.000Z",
              type: "output",
              data: "before",
            },
          },
          {
            id: 2,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:01.000Z",
              type: "output",
              data: "after",
            },
          },
        ],
        "2026-04-02T20:00:00.500Z",
      ).map((entry) => entry.id),
    ).toEqual([2]);
  });

  it("applies only terminal events that have not already been consumed", () => {
    expect(
      selectPendingTerminalEventEntries(
        [
          {
            id: 1,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:00.000Z",
              type: "output",
              data: "one",
            },
          },
          {
            id: 2,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:01.000Z",
              type: "output",
              data: "two",
            },
          },
        ],
        1,
      ).map((entry) => entry.id),
    ).toEqual([2]);
  });
});

describe("resolveThreadTerminalDrawerLayout", () => {
  it("derives active group, visible terminals, labels, and tab metadata in one pass", () => {
    const layout = resolveThreadTerminalDrawerLayout({
      terminalIds: ["default", "terminal-2", "terminal-3"],
      activeTerminalId: "terminal-2",
      activeTerminalGroupId: "group-default",
      terminalGroups: [
        {
          id: "group-default",
          terminalIds: ["default", "terminal-2"],
          splitOrientation: "horizontal",
        },
        { id: "group-terminal-3", terminalIds: ["terminal-3"] },
      ],
    });

    expect(layout.activeTerminalId).toBe("terminal-2");
    expect(layout.activeGroupIndex).toBe(0);
    expect(layout.visibleTerminalIds).toEqual(["default", "terminal-2"]);
    expect(layout.visibleSplitLayout).toEqual({
      type: "split",
      orientation: "horizontal",
      children: [
        { type: "terminal", terminalId: "default" },
        { type: "terminal", terminalId: "terminal-2" },
      ],
    });
    expect(layout.terminalLabelById.get("terminal-3")).toBe("Terminal 3");
    expect(layout.tabs).toEqual([
      {
        groupId: "group-default",
        terminalIds: ["default", "terminal-2"],
        terminalId: "terminal-2",
        label: "Split 1",
        active: true,
      },
      {
        groupId: "group-terminal-3",
        terminalIds: ["terminal-3"],
        terminalId: "terminal-3",
        label: "Terminal 3",
        active: false,
      },
    ]);
    expect(layout.showTerminalTabs).toBe(true);
    expect(layout.isSplitView).toBe(true);
  });

  it("falls back to the default terminal when given an empty layout", () => {
    const layout = resolveThreadTerminalDrawerLayout({
      terminalIds: [],
      activeTerminalId: "",
      activeTerminalGroupId: "",
      terminalGroups: [],
    });

    expect(layout.terminalIds).toEqual(["default"]);
    expect(layout.activeTerminalId).toBe("default");
    expect(layout.visibleTerminalIds).toEqual(["default"]);
    expect(layout.visibleSplitLayout).toBeUndefined();
    expect(layout.showTerminalTabs).toBe(false);
    expect(layout.tabs).toEqual([
      {
        groupId: "group-default",
        terminalIds: ["default"],
        terminalId: "default",
        label: "Terminal 1",
        active: true,
      },
    ]);
  });
});
