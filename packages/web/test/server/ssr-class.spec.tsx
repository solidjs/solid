/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal } from "solid-js";

describe("SSR class primitive values (#3189)", () => {
  test("dynamic numeric class matches the static form", () => {
    const [value] = createSignal(1);
    const html = renderToString(() => <div class={value()} />);
    expect(html).toContain('class="1"');
  });

  test("dynamic zero class matches the static form", () => {
    const [value] = createSignal(0);
    const html = renderToString(() => <div class={value()} />);
    expect(html).toContain('class="0"');
  });

  test("standalone booleans in arrays are ignored", () => {
    const [value] = createSignal([true, false, "active"] as const);
    const html = renderToString(() => <div class={value() as any} />);
    expect(html).toContain('class="active"');
  });
});
