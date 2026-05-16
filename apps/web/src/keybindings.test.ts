import { assert, describe, it } from "vitest";

import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  formatShortcutLabel,
  isChatNewShortcut,
  isChatNewLocalShortcut,
  isDiffToggleShortcut,
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  isOpenFavoriteEditorShortcut,
  isTerminalClearShortcut,
  isTerminalCloseShortcut,
  isTerminalNewShortcut,
  isTerminalSplitShortcut,
  isTerminalTabNextShortcut,
  isTerminalTabPreviousShortcut,
  isTerminalTogglePlacementShortcut,
  isTerminalToggleShortcut,
  isNativeTerminalNewTabShortcut,
  nativeTerminalTabTraversalDirection,
  resolveTerminalShortcutAction,
  resolveTerminalTabJumpIndex,
  resolveShortcutCommand,
  shouldShowModelPickerJumpHints,
  shouldShowThreadJumpHints,
  shortcutLabelForCommand,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
  terminalShortcutActionFromCommand,
  terminalTabJumpCommandForIndex,
  terminalTabJumpIndexFromCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
  type ShortcutEventLike,
} from "./keybindings";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function modShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function whenAnd(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "and", left, right };
}

interface TestBinding {
  shortcut: KeybindingShortcut;
  command: KeybindingCommand;
  whenAst?: KeybindingWhenNode;
}

function compile(bindings: TestBinding[]): ResolvedKeybindingsConfig {
  return bindings.map((binding) => ({
    command: binding.command,
    shortcut: binding.shortcut,
    ...(binding.whenAst ? { whenAst: binding.whenAst } : {}),
  }));
}

const DEFAULT_BINDINGS = compile([
  { shortcut: modShortcut("j"), command: "terminal.toggle" },
  { shortcut: modShortcut("j", { shiftKey: true }), command: "terminal.togglePlacement" },
  {
    shortcut: modShortcut("d"),
    command: "terminal.split",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("d", { shiftKey: true }),
    command: "terminal.splitHorizontal",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("t"),
    command: "terminal.new",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("w"),
    command: "terminal.close",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("d"),
    command: "diff.toggle",
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  {
    shortcut: modShortcut("k"),
    command: "commandPalette.toggle",
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  {
    shortcut: modShortcut("m", { shiftKey: true }),
    command: "modelPicker.toggle",
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  { shortcut: modShortcut("o", { shiftKey: true }), command: "chat.new" },
  { shortcut: modShortcut("n", { shiftKey: true }), command: "chat.newLocal" },
  { shortcut: modShortcut("o"), command: "editor.openFavorite" },
  { shortcut: modShortcut("[", { shiftKey: true }), command: "thread.previous" },
  { shortcut: modShortcut("]", { shiftKey: true }), command: "thread.next" },
  {
    shortcut: modShortcut("["),
    command: "terminal.tabPrevious",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("]"),
    command: "terminal.tabNext",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("p", { shiftKey: true }),
    command: "terminal.pinDrawer",
    whenAst: whenIdentifier("terminalFocus"),
  },
  { shortcut: modShortcut("1"), command: "thread.jump.1" },
  { shortcut: modShortcut("2"), command: "thread.jump.2" },
  { shortcut: modShortcut("3"), command: "thread.jump.3" },
  {
    shortcut: modShortcut("1"),
    command: "modelPicker.jump.1",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
  {
    shortcut: modShortcut("2"),
    command: "modelPicker.jump.2",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
  {
    shortcut: modShortcut("3"),
    command: "modelPicker.jump.3",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
  {
    shortcut: modShortcut("1"),
    command: "terminal.tab.1",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("2"),
    command: "terminal.tab.2",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("3"),
    command: "terminal.tab.3",
    whenAst: whenIdentifier("terminalFocus"),
  },
]);

describe("isTerminalToggleShortcut", () => {
  it("matches Cmd+J on macOS", () => {
    assert.isTrue(
      isTerminalToggleShortcut(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });

  it("matches Ctrl+J on non-macOS", () => {
    assert.isTrue(
      isTerminalToggleShortcut(event({ ctrlKey: true }), DEFAULT_BINDINGS, { platform: "Win32" }),
    );
  });

  it("matches Ctrl+J on non-macOS while terminalFocus is true", () => {
    assert.isTrue(
      isTerminalToggleShortcut(event({ ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Win32",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("isTerminalTogglePlacementShortcut", () => {
  it("matches Mod+Shift+J without requiring the terminal to be open", () => {
    assert.isTrue(
      isTerminalTogglePlacementShortcut(
        event({ key: "j", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { terminalOpen: false, terminalFocus: false },
        },
      ),
    );
    assert.isTrue(
      isTerminalTogglePlacementShortcut(
        event({ key: "j", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
          context: { terminalOpen: false, terminalFocus: true },
        },
      ),
    );
  });
});

describe("split/new/close terminal shortcuts", () => {
  it("requires terminalFocus for default split/new/close bindings", () => {
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "d", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalCloseShortcut(event({ key: "w", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
    );
  });

  it("matches split/new when terminalFocus is true", () => {
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.strictEqual(
      resolveTerminalShortcutAction(
        event({ key: "d", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
          context: { terminalFocus: true },
        },
      ),
      "splitHorizontal",
    );
    assert.isTrue(
      isTerminalNewShortcut(event({ key: "t", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isTrue(
      isTerminalCloseShortcut(event({ key: "w", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
  });

  it("supports when expressions", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "terminal.split",
        whenAst: whenAnd(whenIdentifier("terminalOpen"), whenNot(whenIdentifier("terminalFocus"))),
      },
      {
        shortcut: modShortcut("n", { shiftKey: true }),
        command: "terminal.new",
        whenAst: whenAnd(whenIdentifier("terminalOpen"), whenNot(whenIdentifier("terminalFocus"))),
      },
      { shortcut: modShortcut("j"), command: "terminal.toggle" },
    ]);
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: true, terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: false, terminalFocus: false },
      }),
    );
    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true, shiftKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: true, terminalFocus: false },
      }),
    );
  });

  it("supports when boolean literals", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "terminal.new", whenAst: whenIdentifier("true") },
      { shortcut: modShortcut("m"), command: "terminal.new", whenAst: whenIdentifier("false") },
    ]);

    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "m", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
    );
  });
});

describe("terminal tab shortcuts", () => {
  it("recognizes native new-tab shortcuts even without configured keybindings", () => {
    assert.isTrue(isNativeTerminalNewTabShortcut(event({ key: "t", metaKey: true }), "MacIntel"));
    assert.isTrue(isNativeTerminalNewTabShortcut(event({ key: "t", ctrlKey: true }), "Linux"));
    assert.isFalse(
      isNativeTerminalNewTabShortcut(
        event({ key: "t", metaKey: true, shiftKey: true }),
        "MacIntel",
      ),
    );
  });

  it("recognizes native tab traversal shortcuts even without configured keybindings", () => {
    assert.strictEqual(
      nativeTerminalTabTraversalDirection(
        event({ key: "[", code: "BracketLeft", metaKey: true }),
        "MacIntel",
      ),
      "previous",
    );
    assert.strictEqual(
      nativeTerminalTabTraversalDirection(
        event({ key: "]", code: "BracketRight", ctrlKey: true }),
        "Linux",
      ),
      "next",
    );
    assert.isNull(
      nativeTerminalTabTraversalDirection(
        event({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
        "MacIntel",
      ),
    );
  });

  it("uses Cmd+[ and Cmd+] on macOS while the terminal is focused", () => {
    assert.isTrue(
      isTerminalTabPreviousShortcut(
        event({ key: "[", code: "BracketLeft", metaKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { terminalFocus: true },
        },
      ),
    );
    assert.isTrue(
      isTerminalTabNextShortcut(
        event({ key: "]", code: "BracketRight", metaKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { terminalFocus: true },
        },
      ),
    );
  });

  it("uses Ctrl+[ and Ctrl+] on non-macOS while the terminal is focused", () => {
    assert.isTrue(
      isTerminalTabPreviousShortcut(
        event({ key: "[", code: "BracketLeft", ctrlKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
          context: { terminalFocus: true },
        },
      ),
    );
    assert.isTrue(
      isTerminalTabNextShortcut(
        event({ key: "]", code: "BracketRight", ctrlKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
          context: { terminalFocus: true },
        },
      ),
    );
  });

  it("lets thread traversal keep the same shortcuts outside terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { terminalFocus: false },
        },
      ),
      "thread.previous",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { terminalFocus: false },
        },
      ),
      "thread.next",
    );
  });
});

describe("shortcutLabelForCommand", () => {
  it("returns the effective binding label", () => {
    const bindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "terminal.split",
        whenAst: whenIdentifier("terminalFocus"),
      },
      {
        shortcut: modShortcut("\\", { shiftKey: true }),
        command: "terminal.split",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
    ]);
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "terminal.split", {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
      "Ctrl+Shift+\\",
    );
  });

  it("returns effective labels for non-terminal commands", () => {
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.new", "MacIntel"), "⇧⌘O");
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "diff.toggle", "Linux"), "Ctrl+D");
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "commandPalette.toggle", "MacIntel"),
      "⌘K",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "modelPicker.toggle", "Linux"),
      "Ctrl+Shift+M",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "editor.openFavorite", "Linux"),
      "Ctrl+O",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.jump.3", "MacIntel"),
      "⌘3",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.togglePlacement", "MacIntel"),
      "⇧⌘J",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.splitHorizontal", {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "⇧⌘D",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.pinDrawer", {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "⇧⌘P",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.pinDrawer", {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
      "Ctrl+Shift+P",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.previous", "Linux"),
      "Ctrl+Shift+[",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "modelPicker.jump.3", {
        platform: "MacIntel",
        context: { modelPickerOpen: true },
      }),
      "⌘3",
    );
  });

  it("returns null for commands shadowed by a later conflicting shortcut", () => {
    const bindings = compile([
      { shortcut: modShortcut("1", { shiftKey: true }), command: "thread.jump.1" },
      { shortcut: modShortcut("1", { shiftKey: true }), command: "thread.jump.7" },
    ]);

    assert.isNull(shortcutLabelForCommand(bindings, "thread.jump.1", "MacIntel"));
    assert.strictEqual(shortcutLabelForCommand(bindings, "thread.jump.7", "MacIntel"), "⇧⌘1");
  });

  it("respects when-context while resolving labels", () => {
    const bindings = compile([
      { shortcut: modShortcut("d"), command: "diff.toggle" },
      {
        shortcut: modShortcut("d"),
        command: "terminal.split",
        whenAst: whenIdentifier("terminalFocus"),
      },
    ]);

    assert.strictEqual(
      shortcutLabelForCommand(bindings, "diff.toggle", {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
      "Ctrl+D",
    );
    assert.isNull(
      shortcutLabelForCommand(bindings, "diff.toggle", {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "terminal.split", {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
      "Ctrl+D",
    );
  });
});

describe("thread navigation helpers", () => {
  it("maps jump commands to visible thread indices", () => {
    assert.strictEqual(threadJumpCommandForIndex(0), "thread.jump.1");
    assert.strictEqual(threadJumpCommandForIndex(2), "thread.jump.3");
    assert.isNull(threadJumpCommandForIndex(9));
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.1"), 0);
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.3"), 2);
    assert.isNull(threadJumpIndexFromCommand("thread.next"));
  });

  it("maps traversal commands to directions", () => {
    assert.strictEqual(threadTraversalDirectionFromCommand("thread.previous"), "previous");
    assert.strictEqual(threadTraversalDirectionFromCommand("thread.next"), "next");
    assert.isNull(threadTraversalDirectionFromCommand("thread.jump.1"));
    assert.isNull(threadTraversalDirectionFromCommand(null));
  });

  it("shows jump hints only when configured modifiers match", () => {
    assert.isTrue(
      shouldShowThreadJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isFalse(
      shouldShowThreadJumpHints(event({ metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      shouldShowThreadJumpHints(event({ ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });
});

describe("model picker navigation helpers", () => {
  it("maps jump commands to visible model indices", () => {
    assert.strictEqual(modelPickerJumpCommandForIndex(0), "modelPicker.jump.1");
    assert.strictEqual(modelPickerJumpCommandForIndex(2), "modelPicker.jump.3");
    assert.isNull(modelPickerJumpCommandForIndex(9));
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.1"), 0);
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.3"), 2);
    assert.isNull(modelPickerJumpIndexFromCommand("thread.jump.1"));
  });

  it("shows jump hints only while the model picker context is active", () => {
    assert.isFalse(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: false },
      }),
    );
    assert.isTrue(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: true },
      }),
    );
  });
});

describe("chat/editor shortcuts", () => {
  it("matches chat.new shortcut", () => {
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches chat.newLocal shortcut", () => {
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "n", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "n", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches editor.openFavorite shortcut", () => {
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches commandPalette.toggle shortcut outside terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
      "commandPalette.toggle",
    );
    assert.notStrictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "commandPalette.toggle",
    );
  });

  it("matches diff.toggle shortcut outside terminal focus", () => {
    assert.isTrue(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("cross-command precedence", () => {
  it("uses when + order so a later focused rule overrides a global rule", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new" },
      {
        shortcut: modShortcut("n"),
        command: "terminal.new",
        whenAst: whenIdentifier("terminalFocus"),
      },
    ]);

    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isFalse(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
  });

  it("still lets a later global rule win when both rules match", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("n"),
        command: "terminal.new",
        whenAst: whenIdentifier("terminalFocus"),
      },
      { shortcut: modShortcut("n"), command: "chat.new" },
    ]);

    assert.isFalse(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("resolveShortcutCommand", () => {
  it("returns dynamic script commands", () => {
    const keybindings = compile([{ shortcut: modShortcut("r"), command: "script.setup.run" }]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
      "script.setup.run",
    );
  });

  it("matches bracket shortcuts using the physical key code", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
        },
      ),
      "thread.previous",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
        },
      ),
      "thread.next",
    );
  });
});

describe("formatShortcutLabel", () => {
  it("formats labels for macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "MacIntel"),
      "⇧⌘D",
    );
  });

  it("formats labels for non-macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "Linux"),
      "Ctrl+Shift+D",
    );
  });

  it("formats labels for plus key", () => {
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "MacIntel"), "⌘+");
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "Linux"), "Ctrl++");
  });
});

describe("terminalShortcutActionFromCommand", () => {
  it("maps terminal.togglePlacement to a placement-only action", () => {
    assert.strictEqual(
      terminalShortcutActionFromCommand("terminal.togglePlacement"),
      "togglePlacement",
    );
  });

  it("maps terminal.splitHorizontal to a horizontal split action", () => {
    assert.strictEqual(
      terminalShortcutActionFromCommand("terminal.splitHorizontal"),
      "splitHorizontal",
    );
  });

  it("maps terminal.pinDrawer to the pinDrawer action", () => {
    assert.strictEqual(terminalShortcutActionFromCommand("terminal.pinDrawer"), "pinDrawer");
  });
});

describe("pin drawer shortcut", () => {
  it("resolves Mod+Shift+P to pinDrawer when terminalFocus is true", () => {
    assert.strictEqual(
      resolveTerminalShortcutAction(
        event({ key: "p", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: true } },
      ),
      "pinDrawer",
    );
    assert.strictEqual(
      resolveTerminalShortcutAction(
        event({ key: "p", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        { platform: "Linux", context: { terminalFocus: true } },
      ),
      "pinDrawer",
    );
  });

  it("does not resolve pin drawer when terminalFocus is false", () => {
    assert.isNull(
      resolveTerminalShortcutAction(
        event({ key: "p", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: false } },
      ),
    );
  });
});

describe("isTerminalClearShortcut", () => {
  it("matches Ctrl+L on all platforms", () => {
    assert.isTrue(isTerminalClearShortcut(event({ key: "l", ctrlKey: true }), "Linux"));
    assert.isTrue(isTerminalClearShortcut(event({ key: "l", ctrlKey: true }), "MacIntel"));
  });

  it("matches Cmd+K on macOS", () => {
    assert.isTrue(isTerminalClearShortcut(event({ key: "k", metaKey: true }), "MacIntel"));
  });

  it("ignores non-keydown events", () => {
    assert.isFalse(
      isTerminalClearShortcut(event({ type: "keyup", key: "l", ctrlKey: true }), "Linux"),
    );
  });
});

describe("terminalDeleteShortcutData", () => {
  it("maps Cmd+Backspace on macOS to delete-to-line-start", () => {
    assert.strictEqual(
      terminalDeleteShortcutData(event({ key: "Backspace", metaKey: true }), "MacIntel"),
      "\u0015",
    );
  });

  it("ignores non-macOS platforms and modified variants", () => {
    assert.isNull(terminalDeleteShortcutData(event({ key: "Backspace", metaKey: true }), "Linux"));
    assert.isNull(
      terminalDeleteShortcutData(
        event({ key: "Backspace", metaKey: true, altKey: true }),
        "MacIntel",
      ),
    );
  });

  it("ignores non-keydown events", () => {
    assert.isNull(
      terminalDeleteShortcutData(
        event({ type: "keyup", key: "Backspace", metaKey: true }),
        "MacIntel",
      ),
    );
  });
});

describe("terminalNavigationShortcutData", () => {
  it("maps Option+Arrow on macOS to word movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", altKey: true }), "MacIntel"),
      "\u001bb",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", altKey: true }), "MacIntel"),
      "\u001bf",
    );
  });

  it("maps Cmd+Arrow on macOS to line movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", metaKey: true }), "MacIntel"),
      "\u0001",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", metaKey: true }), "MacIntel"),
      "\u0005",
    );
  });

  it("maps Ctrl+Arrow on non-macOS to word movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", ctrlKey: true }), "Win32"),
      "\u001bb",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", ctrlKey: true }), "Linux"),
      "\u001bf",
    );
  });

  it("rejects unsupported combinations", () => {
    assert.isNull(
      terminalNavigationShortcutData(
        event({ key: "ArrowLeft", shiftKey: true, altKey: true }),
        "MacIntel",
      ),
    );
    assert.isNull(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", metaKey: true }), "Linux"),
    );
    assert.isNull(terminalNavigationShortcutData(event({ key: "a", altKey: true }), "MacIntel"));
  });

  it("ignores non-keydown events", () => {
    assert.isNull(
      terminalNavigationShortcutData(
        event({ type: "keyup", key: "ArrowLeft", altKey: true }),
        "MacIntel",
      ),
    );
  });
});

describe("plus key parsing", () => {
  it("matches the plus key shortcut", () => {
    const plusBindings = compile([{ shortcut: modShortcut("+"), command: "terminal.toggle" }]);
    assert.isTrue(
      isTerminalToggleShortcut(event({ key: "+", metaKey: true }), plusBindings, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isTerminalToggleShortcut(event({ key: "+", ctrlKey: true }), plusBindings, {
        platform: "Linux",
      }),
    );
  });
});

describe("terminal tab jump shortcuts", () => {
  it("maps terminal.tab.N commands to 0-based indices", () => {
    assert.strictEqual(terminalTabJumpCommandForIndex(0), "terminal.tab.1");
    assert.strictEqual(terminalTabJumpCommandForIndex(8), "terminal.tab.9");
    assert.isNull(terminalTabJumpCommandForIndex(9));
    assert.strictEqual(terminalTabJumpIndexFromCommand("terminal.tab.1"), 0);
    assert.strictEqual(terminalTabJumpIndexFromCommand("terminal.tab.9"), 8);
    assert.isNull(terminalTabJumpIndexFromCommand("thread.jump.1"));
    assert.isNull(terminalTabJumpIndexFromCommand("terminal.tabNext"));
  });

  it("resolves Mod+1 to tab jump index 0 when terminalFocus is true", () => {
    assert.strictEqual(
      resolveTerminalTabJumpIndex(
        event({ key: "1", metaKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: true } },
      ),
      0,
    );
    assert.strictEqual(
      resolveTerminalTabJumpIndex(
        event({ key: "3", ctrlKey: true }),
        DEFAULT_BINDINGS,
        { platform: "Linux", context: { terminalFocus: true } },
      ),
      2,
    );
  });

  it("returns null when terminalFocus is false", () => {
    assert.isNull(
      resolveTerminalTabJumpIndex(
        event({ key: "1", metaKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: false } },
      ),
    );
  });

  it("Mod+1 resolves to terminal.tab.1 (not thread.jump.1) when terminalFocus is true", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "1", metaKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: true } },
      ),
      "terminal.tab.1",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "1", metaKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel", context: { terminalFocus: false } },
      ),
      "thread.jump.1",
    );
  });

  it("shortcutLabelForCommand returns the correct label for terminal.tab.1", () => {
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.tab.1", {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "⌘1",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "terminal.tab.1", {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
      "Ctrl+1",
    );
  });
});
