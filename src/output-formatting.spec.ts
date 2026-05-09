import { describe, expect, it } from "vitest";
import { parseAnsiOutput, parseDiffOutput, plainTerminalText } from "./output-formatting";

describe("output formatting", () => {
  it("splits ANSI output into styled text segments", () => {
    const segments = parseAnsiOutput(
      "plain \x1b[31mred\x1b[1m bold\x1b[39m still bold\x1b[22m done",
    );

    expect(segments).toEqual([
      { key: "0", text: "plain ", className: "" },
      { key: "1", text: "red", className: "ansi-fg-red" },
      { key: "2", text: " bold", className: "ansi-bold ansi-fg-red" },
      { key: "3", text: " still bold", className: "ansi-bold" },
      { key: "4", text: " done", className: "" },
    ]);
  });

  it("removes terminal control sequences when building plain text", () => {
    expect(plainTerminalText("\x1b[2K[32mok[0m")).toBe("ok");
  });

  it("classifies diff lines while preserving their display prefix", () => {
    const lines = parseDiffOutput([
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1 +1 @@",
      "-old value",
      "+new value",
      " unchanged",
    ].join("\n"));

    expect(lines.map((line) => ({
      prefix: line.prefix,
      content: line.content,
      className: line.className,
    }))).toEqual([
      { prefix: "-", content: "-- a/file.ts", className: "diff-line-file" },
      { prefix: "+", content: "++ b/file.ts", className: "diff-line-file" },
      { prefix: "@", content: "@ -1 +1 @@", className: "diff-line-hunk" },
      { prefix: "-", content: "old value", className: "diff-line-removed" },
      { prefix: "+", content: "new value", className: "diff-line-added" },
      { prefix: " ", content: "unchanged", className: "diff-line-context" },
    ]);
  });
});
