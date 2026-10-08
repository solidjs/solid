/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #3928 — `<select value>` is written immediately and again in a microtask,
 * which only covers options inserted in the same turn. Options that arrive
 * later (an async memo, including under `<Loading>`) leave the browser on
 * the first option.
 */
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush } from "solid-js";
import { For, Loading, render } from "@solidjs/web";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("#3928 select value when options arrive later", () => {
  test("keeps a static value when options are inserted on a later turn", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} value="b">
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    await Promise.resolve();
    expect(select.options.length).toBe(0);

    setOptions(["a", "b"]);
    flush();
    await Promise.resolve();

    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(1);
    dispose();
    root.remove();
  });

  test("selects the bound value when options load inside Loading", async () => {
    const options = createMemo(async () => {
      await delay(30);
      return ["a", "b"] as string[];
    });
    let select: HTMLSelectElement | undefined;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <Loading fallback={<p>loading</p>}>
          <select
            ref={el => {
              select = el;
            }}
            value="b"
          >
            <For each={options()}>{item => <option value={item}>{item}</option>}</For>
          </select>
        </Loading>
      ),
      root
    );

    await delay(80);
    flush();
    await Promise.resolve();

    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select!.value).toBe("b");
    expect(select!.selectedIndex).toBe(1);
    dispose();
    root.remove();
  });

  test("a later value write still wins once options exist", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    const [value, setValue] = createSignal("b");
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} value={value()}>
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    setOptions(["a", "b", "c"]);
    flush();
    await Promise.resolve();
    expect(select.value).toBe("b");

    setValue("c");
    flush();
    await Promise.resolve();
    expect(select.value).toBe("c");
    dispose();
    root.remove();
  });
});
