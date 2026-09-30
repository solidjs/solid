/**
 * @jsxImportSource @solidjs/web
 */
// `ssrClassName` and `ssrStyle` join object entries with a separator. A
// skipped first entry — a false class, a nullish style value — must not leave
// one behind: the client writes `on` and `top: 1px`, not ` on` and `;top:1px`.
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal } from "solid-js";

describe("SSR class and style separators", () => {
  test("a skipped first class key leaves no leading space", () => {
    const [value] = createSignal({ off: false, on: true });
    const html = renderToString(() => <div class={value()} />);
    expect(html).toContain('class="on"');
  });

  test("a skipped first style key leaves no leading semicolon", () => {
    const [value] = createSignal({ color: undefined as string | undefined, top: "1px" });
    const html = renderToString(() => <div style={value()} />);
    expect(html).toContain('style="top:1px"');
  });
});
