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

  test("selects the bound value when options arrive inside an optgroup", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} value="b">
          <optgroup label="g">
            <For each={options()}>{item => <option value={item}>{item}</option>}</For>
          </optgroup>
        </select>
      ),
      root
    );

    setOptions(["a", "b"]);
    flush();
    await Promise.resolve();

    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(1);
    dispose();
    root.remove();
  });

  test("does not clobber a user selection once the bound value has applied", async () => {
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

    setOptions(["a", "b"]);
    flush();
    await Promise.resolve();
    expect(select.value).toBe("b");

    select.value = "a";
    setOptions(["a", "b", "c"]);
    flush();
    await Promise.resolve();
    expect(select.value).toBe("a");
    dispose();
    root.remove();
  });

  test("selects a same-turn option whose value is assigned without another insert", async () => {
    const id = (value: string) => value;
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} value={id("b")}>
          <option value={id("b")}>Label</option>
        </select>
      ),
      root
    );

    flush();
    await Promise.resolve();
    expect(select.value).toBe("b");
    dispose();
    root.remove();
  });
});

describe("#3928 multiple select value when options arrive later", () => {
  const picked = (select: HTMLSelectElement) =>
    Array.from(select.options, option => (option.selected ? option.value : "")).filter(Boolean);

  test("selects options that arrive separately and clears the pending value only after both", async () => {
    const wanted = ["a", "c"];
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement & { _$v?: unknown };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} multiple value={wanted}>
          <option value="b">b</option>
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    await Promise.resolve();
    expect(picked(select)).toEqual([]);
    expect(select._$v).toEqual(wanted);

    setOptions(["a"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a"]);
    expect(select._$v).toEqual(wanted);

    setOptions(["a", "c"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a", "c"]);
    expect(select._$v).toBeNull();
    dispose();
    root.remove();
  });

  test("a later insert after completion does not clobber a user change", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} multiple value={["a", "c"]}>
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    setOptions(["a", "c"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a", "c"]);

    select.options[1].selected = false;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setOptions(["a", "c", "d"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a"]);
    dispose();
    root.remove();
  });

  test("a user change while still pending is not overwritten by the next option", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement & { _$v?: unknown };
    let seen = 0;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select
          ref={select}
          multiple
          value={["a", "c"]}
          onChange={() => {
            seen++;
          }}
        >
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    setOptions(["a"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a"]);
    expect(select._$v).toEqual(["a", "c"]);

    select.options[0].selected = false;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).toBe(1);
    expect(select._$v).toBeNull();

    setOptions(["a", "c"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual([]);
    dispose();
    root.remove();
  });

  test("selects values inside an optgroup as those options arrive", async () => {
    const [options, setOptions] = createSignal<string[]>([]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} multiple value={["a", "c"]}>
          <optgroup label="g">
            <For each={options()}>{item => <option value={item}>{item}</option>}</For>
          </optgroup>
        </select>
      ),
      root
    );

    setOptions(["a"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a"]);

    setOptions(["a", "c"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["a", "c"]);
    expect(select.selectedIndex).toBe(0);
    dispose();
    root.remove();
  });

  test("numeric entries match string option values", async () => {
    const [options, setOptions] = createSignal<number[]>([]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    // `<select value>` arrays are `string[]`. The numbers stay numbers at runtime (`"1" == 1`).
    const values = [1, 3] as unknown as string[];
    const dispose = render(
      () => (
        <select ref={select} multiple value={values}>
          <For each={options()}>{item => <option value={item}>{item}</option>}</For>
        </select>
      ),
      root
    );

    setOptions([1, 2, 3]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["1", "3"]);
    dispose();
    root.remove();
  });

  test("a later array write replaces the previous selection", async () => {
    const [value, setValue] = createSignal(["a", "b"]);
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <select ref={select} multiple value={value()}>
          <option value="a">a</option>
          <option value="b">b</option>
          <option value="c">c</option>
        </select>
      ),
      root
    );

    await Promise.resolve();
    expect(picked(select)).toEqual(["a", "b"]);

    setValue(["c"]);
    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["c"]);
    dispose();
    root.remove();
  });

  test("selects a same-turn option whose numeric value is assigned without another insert", async () => {
    const id = (value: number) => value;
    let select!: HTMLSelectElement;
    const root = document.createElement("div");
    document.body.appendChild(root);
    // Same boundary: the array entries are numbers; the type is `string[]`.
    const values = [id(1), id(2)] as unknown as string[];
    const dispose = render(
      () => (
        <select ref={select} multiple value={values}>
          <option value={id(1)}>One</option>
          <option value={id(2)}>Two</option>
        </select>
      ),
      root
    );

    flush();
    await Promise.resolve();
    expect(picked(select)).toEqual(["1", "2"]);
    dispose();
    root.remove();
  });
});
