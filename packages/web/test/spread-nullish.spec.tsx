/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A lone reactive spread whose source is absent (#3297). `<input
 * {...props()} />` compiles to `spread(el, props)` with the accessor passed
 * straight through (#3105), so spread() itself has to treat a nullish source
 * as an empty spread: nothing throws, attributes applied by the previous
 * value are removed, and the app keeps updating.
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

describe("lone reactive spread with a nullish source (#3297)", () => {
  test.each([undefined, null])("clearing the source to %s removes its attributes", absent => {
    const host = document.createElement("div");
    const [props, setProps] = createSignal<{ value: string; title: string } | undefined | null>({
      value: "draft",
      title: "t"
    });
    const dispose = render(() => <input {...props()} />, host);
    const input = host.firstElementChild as HTMLInputElement;
    expect(input.value).toBe("draft");
    expect(input.getAttribute("title")).toBe("t");
    setProps(absent);
    flush();
    expect(input.value).toBe("");
    expect(input.hasAttribute("title")).toBe(false);
    // Reactivity is still alive.
    setProps({ value: "again", title: "u" });
    flush();
    expect(input.value).toBe("again");
    expect(input.getAttribute("title")).toBe("u");
    dispose();
  });

  test("mounting with an absent source renders the bare element", () => {
    const host = document.createElement("div");
    const [props, setProps] = createSignal<{ id: string } | undefined>(undefined);
    const dispose = render(() => <input {...props()} />, host);
    const input = host.firstElementChild as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.attributes.length).toBe(0);
    setProps({ id: "x" });
    flush();
    expect(input.id).toBe("x");
    dispose();
  });

  test("a static null spread is an empty spread", () => {
    const host = document.createElement("div");
    const dispose = render(() => <input {...(null as any)} />, host);
    expect(host.innerHTML).toBe("<input>");
    dispose();
  });
});
