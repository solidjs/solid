/**
 * @jsxImportSource @solidjs/web
 *
 * Server twin of test/polymorphic-chain.spec.tsx: the Kobalte-shaped chain
 * (test/harness/polymorphic.tsx) serializes to the same attribute set as its
 * compiled floor, with consumed keys and `as` absent, and every element
 * carrying a hydration key. Attribute ORDER legitimately differs between the
 * two (the chain's statics are merged in layer order), so compare as sets.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { forms, makeRows, TriggerList } from "../harness/polymorphic.jsx";

function renderForm(form: keyof typeof forms, count: number) {
  const rows = makeRows(0, count);
  return renderToString(() => <TriggerList rows={() => rows} render={forms[form]} />);
}

/** Attribute name→value maps of every `<a …>` in the markup, `_hk` dropped. */
function anchorAttrs(html: string): Record<string, string>[] {
  return [...html.matchAll(/<a\s([^>]*)>/g)].map(m => {
    const out: Record<string, string> = {};
    // values are quoted except the hydration key, which is emitted bare
    for (const a of m[1].matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|([^\s>]+)))?/g))
      if (a[1] !== "_hk") out[a[1]] = a[2] ?? a[3] ?? "";
    return out;
  });
}

describe("polymorphic chain (Kobalte shape) — SSR", () => {
  test("serializes the same attribute set as the compiled floor", () => {
    const chain = anchorAttrs(renderForm("chain", 2));
    const floor = anchorAttrs(renderForm("compiled", 2));
    expect(chain).toHaveLength(2);
    expect(chain).toEqual(floor);
    expect(chain[0]).toEqual({
      role: "button",
      tabindex: "0",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "data-closed": "",
      class: "btn",
      href: "#row-0",
      "data-x": "1",
      "aria-label": "row-0",
      title: "row-0"
    });
  });

  test("every anchor carries a hydration key and its label", () => {
    const html = renderForm("chain", 3);
    const anchors = [...html.matchAll(/<a\s[^>]*>/g)].map(m => m[0]);
    expect(anchors).toHaveLength(3);
    for (const a of anchors) expect(a).toMatch(/ _hk=[^\s>]+/);
    expect(html).toContain(">row-0</a>");
    expect(html).toContain(">row-2</a>");
  });
});
