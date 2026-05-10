import { describe, expect, it } from "vitest";

import {
  closeFileExplorerTab,
  fileExplorerTabDirectionFromShortcut,
  openFileExplorerTab,
  selectAdjacentFileExplorerTab,
} from "./fileExplorerTabs";

describe("file explorer tabs", () => {
  it("opens a file as the active tab without duplicating existing tabs", () => {
    expect(openFileExplorerTab(["src/a.ts"], "src/b.ts")).toEqual({
      tabs: ["src/a.ts", "src/b.ts"],
      activePath: "src/b.ts",
    });
    expect(openFileExplorerTab(["src/a.ts", "src/b.ts"], "src/a.ts")).toEqual({
      tabs: ["src/a.ts", "src/b.ts"],
      activePath: "src/a.ts",
    });
  });

  it("moves active selection to the next neighbor when closing the active tab", () => {
    expect(closeFileExplorerTab(["a.ts", "b.ts", "c.ts"], "b.ts", "b.ts")).toEqual({
      tabs: ["a.ts", "c.ts"],
      activePath: "c.ts",
    });
    expect(closeFileExplorerTab(["a.ts", "b.ts"], "b.ts", "b.ts")).toEqual({
      tabs: ["a.ts"],
      activePath: "a.ts",
    });
  });

  it("keeps active selection when closing an inactive tab", () => {
    expect(closeFileExplorerTab(["a.ts", "b.ts", "c.ts"], "c.ts", "b.ts")).toEqual({
      tabs: ["a.ts", "c.ts"],
      activePath: "c.ts",
    });
  });

  it("wraps adjacent tab selection", () => {
    expect(selectAdjacentFileExplorerTab(["a.ts", "b.ts", "c.ts"], "c.ts", "next")).toBe("a.ts");
    expect(selectAdjacentFileExplorerTab(["a.ts", "b.ts", "c.ts"], "a.ts", "previous")).toBe(
      "c.ts",
    );
  });

  it("matches platform tab switching shortcuts", () => {
    expect(
      fileExplorerTabDirectionFromShortcut(
        { key: "]", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
        "MacIntel",
      ),
    ).toBe("next");
    expect(
      fileExplorerTabDirectionFromShortcut(
        { key: "[", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe("previous");
    expect(
      fileExplorerTabDirectionFromShortcut(
        { key: "]", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        "MacIntel",
      ),
    ).toBeNull();
  });
});
