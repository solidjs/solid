/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";

// #4186: a stateful property binding (`value`, `checked`, ...) lives in its
// template's grouped effect, so any re-run re-writes the bound value — with
// no guard, the signal is the source of truth. When the element holds an
// edit that never reached the signal, that re-write erases it; dev builds
// report it as UNCOMMITTED_INPUT_OVERWRITTEN (and write as usual).

const CODE = "[UNCOMMITTED_INPUT_OVERWRITTEN]";
const warnings = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(args => String(args[0])).filter(m => m.includes(CODE));

describe("UNCOMMITTED_INPUT_OVERWRITTEN (dev)", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container?.remove();
    vi.restoreAllMocks();
  });

  function mount<T extends Element>(fn: () => any): T {
    container = document.createElement("div");
    document.body.appendChild(container);
    dispose = render(fn, container);
    return container.firstElementChild as T;
  }

  function type(input: HTMLInputElement, text: string) {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  test("a controlled input (onInput writes the signal) does not warn when a sibling binding changes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name, setName] = createSignal("Ada");
    const [cls, setCls] = createSignal("a");
    const input = mount<HTMLInputElement>(() => (
      <input class={cls()} value={name()} onInput={e => setName(e.currentTarget.value)} />
    ));
    type(input, "Grace");
    flush();
    setCls("b");
    flush();
    expect(input.className).toBe("b");
    expect(input.value).toBe("Grace");
    expect(warnings(warn)).toEqual([]);
  });

  test("an uncommitted edit overwritten by a grouped re-run warns, and the write still happens", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name] = createSignal("Ada");
    const [cls, setCls] = createSignal("a");
    const commit = vi.fn();
    const input = mount<HTMLInputElement>(() => (
      <input class={cls()} name="first" value={name()} onChange={commit} />
    ));
    type(input, "Grace"); // typed, not yet committed (no change event)
    setCls("b");
    flush();
    expect(input.value).toBe("Ada");
    expect(warnings(warn)).toEqual([
      expect.stringContaining(
        `${CODE} <input type="text" name="first">.value was changed by the user, but the change ` +
          "was never committed to the signal bound to `value`, and Solid is writing the bound " +
          "value back over it: the user's input is lost."
      )
    ]);
    const message = warnings(warn)[0];
    expect(message).toContain("`onInput={e => setValue(e.currentTarget.value)}`");
    expect(message).toContain("use `defaultValue` for an uncontrolled element");
    expect(message).toContain("(`e.currentTarget.value = next`)");
  });

  test("a lone binding re-asserting an equal value (equals: false) over an uncommitted edit warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name, setName] = createSignal("Ada", { equals: false });
    const input = mount<HTMLInputElement>(() => <input value={name()} />);
    type(input, "Grace");
    setName("Ada");
    flush();
    expect(input.value).toBe("Ada");
    expect(warnings(warn)).toHaveLength(1);
  });

  test("a checkbox toggled by the user and re-asserted by a grouped re-run warns for `checked`", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [on] = createSignal(false);
    const [title, setTitle] = createSignal("a");
    const box = mount<HTMLInputElement>(() => (
      <input type="checkbox" title={title()} checked={on()} />
    ));
    box.checked = true; // a click with no handler committing it
    setTitle("b");
    flush();
    expect(box.checked).toBe(false);
    expect(warnings(warn)).toEqual([
      expect.stringContaining(`${CODE} <input type="checkbox">.checked was changed by the user`)
    ]);
    expect(warnings(warn)[0]).toContain("`onChange={e => setValue(e.currentTarget.checked)}`");
    expect(warnings(warn)[0]).toContain("use `defaultChecked`");
  });

  test("a spread re-run over an uncommitted edit warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name] = createSignal("Ada");
    const [cls, setCls] = createSignal("a");
    const props = {
      get class() {
        return cls();
      },
      get value() {
        return name();
      }
    };
    const input = mount<HTMLInputElement>(() => <input {...props} />);
    type(input, "Grace");
    setCls("b");
    flush();
    expect(input.className).toBe("b");
    expect(input.value).toBe("Ada");
    expect(warnings(warn)).toHaveLength(1);
  });

  test("a programmatic change to a different value (a reset) does not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name, setName] = createSignal("Ada");
    const [cls, setCls] = createSignal("a");
    const input = mount<HTMLInputElement>(() => <input class={cls()} value={name()} />);
    type(input, "Grace");
    setName("");
    flush();
    expect(input.value).toBe("");
    setCls("b");
    flush();
    expect(input.value).toBe("");
    expect(warnings(warn)).toEqual([]);
  });

  test("warns once per element and property", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [name] = createSignal("Ada");
    const [cls, setCls] = createSignal("a");
    const input = mount<HTMLInputElement>(() => <input class={cls()} value={name()} />);
    for (const next of ["b", "c", "d"]) {
      type(input, "Grace " + next);
      setCls(next);
      flush();
      expect(input.value).toBe("Ada");
    }
    expect(warnings(warn)).toHaveLength(1);
  });

  test("values the browser coerces (a number) do not look like user edits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(5);
    const [cls, setCls] = createSignal("a");
    const input = mount<HTMLInputElement>(() => (
      <input type="number" class={cls()} value={count() as any} />
    ));
    setCls("b");
    flush();
    expect(input.value).toBe("5");
    expect(warnings(warn)).toEqual([]);
  });
});

describe("UNCOMMITTED_INPUT_OVERWRITTEN, in the built artifacts", () => {
  // Requires a prior `pnpm build`.
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8");

  test("the check ships in the dev client and folds out of prod and observe", () => {
    expect(read("dist/web.dev.js")).toContain("UNCOMMITTED_INPUT_OVERWRITTEN");
    for (const file of ["dist/web.js", "dist/web.observe.js"]) {
      const source = read(file);
      expect(source).not.toContain("UNCOMMITTED_INPUT_OVERWRITTEN");
      expect(source).not.toContain("checkStatefulWrite");
      expect(source).not.toContain("recordStatefulWrite");
    }
  });
});
