/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, flush } from "solid-js";

// Client counterpart of test/server/spread-static-text.spec.tsx (#3557): a
// spread element's static string props reach the runtime decoded, and a
// static textarea `value` keeps its source order against the spread.

const rest = { id: "a" };
// Widened so TS cannot see the duplicate `value` key (TS2783) — the collision
// between the explicit attribute and the spread is the case under test.
const withValue: Record<string, string> = { id: "a", value: "from-spread" };

function mount<T extends Element>(code: () => any): T {
  let el!: T;
  const dispose = createRoot(dispose => {
    el = code() as T;
    return dispose;
  });
  flush();
  dispose();
  return el;
}

describe("static props on spread elements (#3557)", () => {
  test("a static string prop is decoded", () => {
    expect(mount<HTMLDivElement>(() => <div {...rest} title="a &amp; b" />).title).toBe("a & b");
  });

  test("a static textarea value is decoded on both paths", () => {
    expect(
      mount<HTMLTextAreaElement>(() => <textarea {...rest} value="a &lt;b&gt; &amp; c" />).value
    ).toBe("a <b> & c");
    expect(mount<HTMLTextAreaElement>(() => <textarea value="a &lt;b&gt; &amp; c" />).value).toBe(
      "a <b> & c"
    );
  });

  test("a static textarea value follows source order against a spread", () => {
    expect(mount<HTMLTextAreaElement>(() => <textarea {...withValue} value="static" />).value).toBe(
      "static"
    );
    expect(mount<HTMLTextAreaElement>(() => <textarea value="static" {...withValue} />).value).toBe(
      "from-spread"
    );
  });
});
