/** @vitest-environment node */
// The server entry installs the same footer as the client's
// (src/console-footer.ts): the first console report of each code on a server
// render ends with the docs page for a human and the skill pointer (with the
// code's anchor) for an agent. Once per code per process, appended to the
// report's own console call.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEV, OBSERVE } from "../../src/server/index.js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("repair-guide footer (server entry)", () => {
  test("the first report of a code carries the skill pointer and anchor; the second does not", () => {
    const report = () =>
      DEV!.report(
        OBSERVE!.diagnostics.emit(
          {
            code: "REVEAL_IN_RENDER_TO_STRING",
            kind: "ssr",
            severity: "warn",
            message: "[REVEAL_IN_RENDER_TO_STRING] probe"
          },
          null
        )
      );
    report();
    expect(warn).toHaveBeenCalledTimes(1);
    const first = String(warn.mock.calls[0][0]);
    expect(first).toBe(
      "[REVEAL_IN_RENDER_TO_STRING] probe\n" +
        "[REVEAL_IN_RENDER_TO_STRING] what it means and how to fix it: " +
        "https://v2.solidjs.com/reference/solid-js/diagnostics/reveal-in-render-to-string\n" +
        "[REVEAL_IN_RENDER_TO_STRING] agent repair guide: " +
        "node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md#reveal_in_render_to_string — " +
        "https://github.com/solidjs/solid/blob/next/packages/solid/skills/reactivity-diagnostics/SKILL.md#reveal_in_render_to_string"
    );
    // Not a perf/graph/responsiveness code: no attribution pointer.
    expect(first).not.toContain("deeper evidence");

    report();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).not.toContain("repair guide");
    expect(String(warn.mock.calls[1][0])).not.toContain("how to fix it");
  });
});
