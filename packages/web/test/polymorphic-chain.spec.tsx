/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The Kobalte-shaped component chain (test/harness/polymorphic.tsx) must
 * resolve to exactly the element its compiled floor twin produces: same
 * attribute set after shadowing through merge → omit → merge layers, consumed
 * keys absent, `as` never reaching the DOM, reactive attributes live, and the
 * element kept across updates. The benches measure this tree; these pin what
 * it means so the plumbing can change underneath without moving the target.
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { forms, makeRows, TriggerList, type Row } from "./harness/polymorphic.jsx";

function mount(form: keyof typeof forms, rows: Row[]) {
  const container = document.createElement("div");
  const dispose = render(() => <TriggerList rows={() => rows} render={forms[form]} />, container);
  flush();
  return { container, dispose, anchors: () => [...container.querySelectorAll("a")] };
}

function attrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of el.attributes) out[name] = value;
  return out;
}

describe("polymorphic chain (Kobalte shape)", () => {
  test("resolves to the same element as the compiled floor", () => {
    const chain = mount("chain", makeRows(0, 2));
    const floor = mount("compiled", makeRows(0, 2));
    const [a] = chain.anchors();
    const [b] = floor.anchors();
    expect(a.tagName).toBe("A");
    expect(attrs(a)).toEqual(attrs(b));
    // What the chain decided along the way:
    expect(a.getAttribute("role")).toBe("button"); // as="a" is not a native button
    expect(a.getAttribute("tabindex")).toBe("0");
    expect(a.hasAttribute("type")).toBe(false); // consumed by Button.Root, not a button
    expect(a.hasAttribute("disabled")).toBe(false);
    expect(a.hasAttribute("as")).toBe(false); // hidden by Polymorphic
    expect(a.getAttribute("aria-haspopup")).toBe("dialog");
    expect(a.hasAttribute("data-closed")).toBe(true);
    expect(a.getAttribute("class")).toBe("btn");
    expect(a.getAttribute("href")).toBe("#row-0");
    expect(a.getAttribute("aria-label")).toBe("row-0");
    expect(a.textContent).toBe("row-0");
    chain.dispose();
    floor.dispose();
  });

  test("reactive props flow through every layer without recreating the element", () => {
    const rows = makeRows(0, 3);
    const { anchors, dispose } = mount("chain", rows);
    const before = anchors();
    rows[1].setLabel("ROW-1");
    flush();
    const after = anchors();
    expect(after).toEqual(before);
    expect(after[1].getAttribute("aria-label")).toBe("ROW-1");
    expect(after[1].getAttribute("title")).toBe("ROW-1");
    expect(after[1].textContent).toBe("ROW-1");
    expect(after[0].getAttribute("aria-label")).toBe("row-0");
    dispose();
  });

  test("the consumed onClick still runs, and context-driven aria updates", () => {
    const rows = makeRows(0, 1);
    const { anchors, dispose } = mount("chain", rows);
    const [a] = anchors();
    expect(a.getAttribute("aria-expanded")).toBe("false");
    a.click();
    flush();
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(a.hasAttribute("data-expanded")).toBe(true);
    expect(a.hasAttribute("data-closed")).toBe(false);
    dispose();
  });
});
