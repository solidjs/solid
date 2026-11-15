/**
 * @jsxImportSource @solidjs/web
 *
 * #4891 — a select-bearing SSR render must not leave a process-wide scan
 * armed for later select-free pages. After one select page, a large
 * select-free page must stay on the fast path (near-zero resolve cost).
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

describe("SSR selectValuesActive is render-local (#4891)", () => {
  test("a select-free render after one select elsewhere stays fast", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => <div class="row">row {i}</div>);

    // One tiny select render, as a compiled `<select value>` does.
    renderToString(() => (
      <select value="b">
        <option value="a">a</option>
        <option value="b">b</option>
      </select>
    ));

    // Warm + measure the select-free page. Sticky module arm made this tens
    // of ms; render-local arm keeps it near zero.
    renderToString(() => <main>{rows}</main>);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) renderToString(() => <main>{rows}</main>);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  test("a select render still resolves the bound option", () => {
    const html = renderToString(() => (
      <select value="b">
        <option value="a">a</option>
        <option value="b">b</option>
      </select>
    ));
    expect(html).toMatch(/<option value="b" selected>b<\/option>/);
    expect(html).not.toMatch(/<select[^>]*value=/);
  });

  test("select resolution still works on a later request after a select-free one", () => {
    renderToString(() => <div>no select</div>);
    const html = renderToString(() => (
      <select value="fr">
        <option value="en">English</option>
        <option value="fr">French</option>
      </select>
    ));
    expect(html).toMatch(/<option value="fr" selected>French<\/option>/);
  });
});
