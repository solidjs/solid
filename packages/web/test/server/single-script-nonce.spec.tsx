/**
 * @jsxImportSource @solidjs/web
 */
// The surfaces that emit one script (HydrationScript, generateHydrationScript,
// createSSRResponse) take the same `CSPNonce` as the render options and use its
// script half, so an app passes `event.nonce` everywhere without projecting it.
import { describe, expect, test } from "vitest";
import { generateHydrationScript, HydrationScript, renderToString } from "@solidjs/web";

const split = { script: "s-1", style: "t-1" };

describe("single-script surfaces take a CSPNonce", () => {
  test("generateHydrationScript uses the script half of a split nonce", () => {
    const html = generateHydrationScript({ nonce: split });
    expect(html.startsWith(`<script nonce="s-1">`)).toBe(true);
    expect(html).not.toContain("t-1");
  });

  test("generateHydrationScript keeps a string nonce and drops a disabled script half", () => {
    expect(generateHydrationScript({ nonce: "abc" }).startsWith(`<script nonce="abc">`)).toBe(true);
    expect(
      generateHydrationScript({ nonce: { script: false, style: "t-1" } }).startsWith("<script>")
    ).toBe(true);
  });

  test("HydrationScript takes a split nonce prop", () => {
    const html = renderToString(() => <HydrationScript nonce={split} />);
    expect(html).toContain(`<script nonce="s-1">window._$HY`);
    expect(html).not.toContain(`nonce="t-1"`);
  });

  test("HydrationScript falls back to the render's split nonce", () => {
    const html = renderToString(() => <HydrationScript />, { nonce: split });
    expect(html).toContain(`<script nonce="s-1">window._$HY`);
  });
});
