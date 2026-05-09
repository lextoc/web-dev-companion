import { describe, expect, it } from "vitest";
import { KEYBINDINGS, keybindingKeys, keybindingLabel } from "./keybindings";

describe("keybindings", () => {
  it("returns platform-specific key sequences", () => {
    expect(keybindingKeys("command-palette", "mac")).toEqual(["⌘K", "/"]);
    expect(keybindingKeys("command-palette", "other")).toEqual(["Ctrl K", "/"]);
    expect(keybindingKeys("open-files", "mac")).toEqual(["⌘⇧F"]);
    expect(keybindingKeys("open-files", "other")).toEqual(["Ctrl Shift F"]);
  });

  it("uses the first configured key as the display label", () => {
    expect(keybindingLabel("command-palette", "mac")).toBe("⌘K");
    expect(keybindingLabel("command-palette", "other")).toBe("Ctrl K");
    expect(keybindingLabel("close-overlay", "mac")).toBe("Esc");
  });

  it("falls back to empty values for unknown keybinding ids", () => {
    expect(keybindingKeys("missing", "mac")).toEqual([]);
    expect(keybindingLabel("missing", "other")).toBe("");
  });

  it("keeps keybinding ids unique so lookups are deterministic", () => {
    const ids = KEYBINDINGS.map((keybinding) => keybinding.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
