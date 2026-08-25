/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// An error that escapes every boundary permanently halts the reactive system
// (REACTIVITY_HALTED). Playground-style embedders re-run render() into the
// same runtime without a page reload, so in dev a fresh render() revives
// scheduling — otherwise the new tree never mounts (its initial effects sit
// in a queue that no flush will ever drain).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

describe("render() halt recovery (dev)", () => {
  const containers: HTMLElement[] = [];

  function mount(code: () => any) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const dispose = render(code, container);
    return { container, dispose };
  }

  afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
  });

  it("a fresh render() after a halt mounts and stays reactive", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [bomb, setBomb] = createSignal(0);
    const first = mount(() => {
      createEffect(bomb, v => {
        if (v === 1) throw new Error("boom");
      });
      return (<div>first app</div>) as any;
    });
    expect(first.container.textContent).toBe("first app");

    expect(() => {
      setBomb(1);
      flush();
    }).toThrow("boom");
    expect(error.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(true);

    // A playground disposes the previous run before re-rendering.
    first.dispose();

    const [count, setCount] = createSignal(0);
    const second = mount(() => (<div>Count: {count()}</div>) as any);
    expect(second.container.textContent).toBe("Count: 0");

    setCount(5);
    flush();
    expect(second.container.textContent).toBe("Count: 5");
  });
});
