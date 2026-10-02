/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal, flush } from "solid-js";
import { assign, render, spread } from "@solidjs/web";

// Only `on` + an uppercase letter (`onClick`) is an event handler in 2.0.
// Lowercase `on*` names are plain attributes: compiled, spread and assigned.

const warnings = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map(args => String(args[0]))
    .filter(m => m.includes("[LOWERCASE_EVENT_ATTRIBUTE]"));

describe("lowercase on* names are attributes", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container?.remove();
    vi.restoreAllMocks();
  });

  function mount(fn: () => any) {
    container = document.createElement("div");
    document.body.appendChild(container);
    dispose = render(fn, container);
    return container.firstElementChild as HTMLElement;
  }

  test("a compiled lowercase on* expression sets the attribute and binds no event", () => {
    const code = "console.log('hi')";
    const button = mount(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onclick={code}
      >
        x
      </button>
    ));
    expect(button.getAttribute("onclick")).toBe(code);
    expect((button as any)._$$click).toBeUndefined();
  });

  test("a dynamic lowercase on* expression is a reactive attribute", () => {
    const [code, setCode] = createSignal<string | undefined>("first()");
    const button = mount(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onmouseover={code()}
      />
    ));
    expect(button.getAttribute("onmouseover")).toBe("first()");
    setCode("second()");
    flush();
    expect(button.getAttribute("onmouseover")).toBe("second()");
    setCode(undefined);
    flush();
    expect(button.hasAttribute("onmouseover")).toBe(false);
  });

  test("camelCase handlers are unchanged beside a lowercase attribute", () => {
    const clicked = vi.fn();
    const button = mount(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onclick="noop()"
        onClick={clicked}
      />
    ));
    expect(button.getAttribute("onclick")).toBe("noop()");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test("spread: a lowercase on* key sets the attribute, a camelCase key binds the event", () => {
    const clicked = vi.fn();
    const [props, setProps] = createSignal<Record<string, unknown>>({ onclick: "run()" });
    const div = mount(() => <div {...props()} />);
    expect(div.getAttribute("onclick")).toBe("run()");
    expect((div as any)._$$click).toBeUndefined();

    setProps({ onClick: clicked });
    flush();
    expect(div.hasAttribute("onclick")).toBe(false);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test("spread and assign: a non-delegated lowercase on* key adds no listener", () => {
    const el = document.createElement("input");
    const listen = vi.spyOn(el, "addEventListener");
    assign(el, { oninput: "update()" });
    expect(el.getAttribute("oninput")).toBe("update()");
    expect(listen).not.toHaveBeenCalled();

    const other = document.createElement("div");
    const listenOther = vi.spyOn(other, "addEventListener");
    spread(other, { onscroll: "track()" });
    flush();
    expect(other.getAttribute("onscroll")).toBe("track()");
    expect(listenOther).not.toHaveBeenCalled();
  });
});

describe("LOWERCASE_EVENT_ATTRIBUTE (dev)", () => {
  afterEach(() => vi.restoreAllMocks());

  test("a function set on a compiled lowercase on* attribute warns and is not a handler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <button
          // @ts-expect-error lowercase on* is not a declared JSX attribute
          onclick={handler}
        />
      ),
      container
    );
    const button = container.firstElementChild as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    expect(button.getAttribute("onclick")).toBe(String(handler));
    expect(warnings(warn)).toEqual([
      expect.stringContaining(
        "[LOWERCASE_EVENT_ATTRIBUTE] `onclick` received a function, but `onclick` is an attribute " +
          "in Solid 2.0, not an event handler: the function was set as the attribute's text. " +
          "Use `onClick` for event handlers."
      )
    ]);
    dispose();
    container.remove();
  });

  test("reports once per attribute name, through spread and assign alike", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = document.createElement("div");
    const b = document.createElement("div");
    spread(a, { ondblclick: () => {} });
    flush();
    assign(b, { ondblclick: () => {} });
    expect(warnings(warn)).toHaveLength(1);
    expect(warnings(warn)[0]).toContain("Use `onDblclick` for event handlers.");
  });

  test("a function on a removed `on:` name warns with the camelCase handler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement("div");
    assign(el, { "on:custom-thing": () => {} });
    expect(el.hasAttribute("on:custom-thing")).toBe(true);
    expect(warnings(warn)).toEqual([
      expect.stringContaining("`on:custom-thing` received a function")
    ]);
    expect(warnings(warn)[0]).toContain("Use `onCustom-thing` for event handlers.");
  });

  test("string values and camelCase handlers do not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement("div");
    assign(el, { onmouseout: "leave()", onMouseOut: () => {} });
    expect(warnings(warn)).toEqual([]);
  });
});

describe("LOWERCASE_EVENT_ATTRIBUTE, in the built artifacts", () => {
  // Requires a prior `pnpm build`.
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8");

  test("the check ships in the dev client and folds out of prod and observe", () => {
    expect(read("dist/web.dev.js")).toContain("LOWERCASE_EVENT_ATTRIBUTE");
    expect(read("dist/web.js")).not.toContain("LOWERCASE_EVENT_ATTRIBUTE");
    expect(read("dist/web.observe.js")).not.toContain("LOWERCASE_EVENT_ATTRIBUTE");
  });
});
