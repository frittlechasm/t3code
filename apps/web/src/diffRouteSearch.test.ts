import { describe, expect, it } from "vitest";

import { isDiffPanelOpen, parseDiffRouteSearch } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("parses panel=diff with turn and file", () => {
    const parsed = parseDiffRouteSearch({
      panel: "diff",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
    expect(isDiffPanelOpen(parsed)).toBe(true);
  });

  it("ignores tasks panel state because tasks use the chat sidebar", () => {
    const parsed = parseDiffRouteSearch({ panel: "tasks" });

    expect(parsed).toEqual({});
    expect(isDiffPanelOpen(parsed)).toBe(false);
  });

  it("keeps legacy diff=1 as a compatibility alias", () => {
    const parsed = parseDiffRouteSearch({ diff: "1" });

    expect(isDiffPanelOpen(parsed)).toBe(true);
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("ignores unknown panel values", () => {
    const parsed = parseDiffRouteSearch({ panel: "unknown" });
    expect(parsed).toEqual({});
  });

  it("isDiffPanelOpen is false for tasks panel", () => {
    const parsed = parseDiffRouteSearch({ panel: "tasks" });
    expect(isDiffPanelOpen(parsed)).toBe(false);
  });
});
