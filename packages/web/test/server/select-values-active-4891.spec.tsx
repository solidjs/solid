/**
 * #4891 — `ssrSelectValues()` must not stick a process-wide scan on every
 * later SSR render. After a select-bearing render (or a module-scope arm),
 * select-free pages must take the fast path again.
 */
import { describe, expect, test } from "vitest";
import {
  renderToString,
  resolveSSRSelectValues,
  ssr,
  ssrSelectValues
} from "@solidjs/web";

describe("SSR selectValuesActive is render-local (#4891)", () => {
  test("a select-free render after one select elsewhere does not keep scanning", () => {
    const body = Array.from(
      { length: 5000 },
      (_, i) => `<div class="row"><span>row ${i}</span></div>`
    ).join("");
    const bigPage = () => ssr`<main>${body}</main>`;

    // One tiny select render, as a compiled `<select value>` does.
    renderToString(() => {
      ssrSelectValues();
      return ssr`<select value="b"><option value="a">a</option><option value="b">b</option></select>`;
    });

    // Same select-free page: resolve must be a no-op (same reference).
    const html = renderToString(bigPage);
    expect(resolveSSRSelectValues(html)).toBe(html);

    // Timing: with the sticky module flag this was tens of ms; fast path is near zero.
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) resolveSSRSelectValues(html);
    expect(performance.now() - t0).toBeLessThan(25);
  });

  test("a select render still resolves the bound option", () => {
    const html = renderToString(() => {
      ssrSelectValues();
      return ssr`<select value="b"><option value="a">a</option><option value="b">b</option></select>`;
    });
    expect(html).toMatch(/<option value="b" selected>b<\/option>/);
    expect(html).not.toMatch(/<select[^>]*value=/);
  });

  test("module-scope arm is a one-shot, not sticky across renders", () => {
    ssrSelectValues(); // no context — schedules one-shot
    const page = () => ssr`<div>no select</div>`;
    renderToString(page); // consumes one-shot
    const html = renderToString(page);
    expect(resolveSSRSelectValues(html)).toBe(html);
  });
});
