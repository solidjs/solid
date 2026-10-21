/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";

// #4186: a stateful DOM property (`value`, `checked`, …) bound next to other
// dynamic attributes used to share the element's grouped effect, so a change
// to any sibling binding re-wrote the property and wiped what the user typed.
// It now has its own effect — written only when its own expression re-runs —
// and the grouped bindings are split around it in source order (#2532).
describe("stateful DOM properties own their effect (#4186)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("typed value survives a min/max change on a grouped input", () => {
    let input!: HTMLInputElement;
    let setMin!: (v: number) => number;
    let setMax!: (v: number) => number;
    let setValue!: (v: string) => string;
    const dispose = createRoot(dispose => {
      const [value, _setValue] = createSignal("1");
      const [min, _setMin] = createSignal(0);
      const [max, _setMax] = createSignal(10);
      setValue = _setValue;
      setMin = _setMin;
      setMax = _setMax;
      input = (<input type="number" value={value()} min={min()} max={max()} />) as HTMLInputElement;
      return dispose;
    });
    flush();
    expect(input.value).toBe("1");
    expect(input.getAttribute("min")).toBe("0");

    // the user types; the signal is not updated (uncontrolled edit)
    input.value = "7";

    setMin(2);
    flush();
    expect(input.getAttribute("min")).toBe("2");
    expect(input.value).toBe("7");

    setMax(20);
    flush();
    expect(input.getAttribute("max")).toBe("20");
    expect(input.value).toBe("7");

    // its own expression re-running still writes it
    setValue("3");
    flush();
    expect(input.value).toBe("3");
    dispose();
  });

  test("a lone value binding is still written whenever it re-runs", () => {
    let input!: HTMLInputElement;
    let setValue!: (v: string) => string;
    const dispose = createRoot(dispose => {
      const [value, _setValue] = createSignal("a");
      setValue = _setValue;
      input = (<input value={value()} />) as HTMLInputElement;
      return dispose;
    });
    flush();
    input.value = "typed";
    setValue("b");
    flush();
    expect(input.value).toBe("b");
    dispose();
  });

  test("user-toggled checked survives a class/title change", () => {
    let input!: HTMLInputElement;
    let setCls!: (v: string) => string;
    let setTitle!: (v: string) => string;
    const dispose = createRoot(dispose => {
      const [done] = createSignal(false);
      const [cls, _setCls] = createSignal("a");
      const [title, _setTitle] = createSignal("t1");
      setCls = _setCls;
      setTitle = _setTitle;
      input = (
        <input type="checkbox" class={cls()} checked={done()} title={title()} />
      ) as HTMLInputElement;
      return dispose;
    });
    flush();
    expect(input.checked).toBe(false);

    input.checked = true; // the user clicks

    setCls("b");
    flush();
    expect(input.className).toBe("b");
    expect(input.checked).toBe(true);

    setTitle("t2");
    flush();
    expect(input.title).toBe("t2");
    expect(input.checked).toBe(true);
    dispose();
  });

  test("bindings apply in source order: type, then value, then min/max", () => {
    const writes: string[] = [];
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    vi.spyOn(HTMLInputElement.prototype, "value", "set").mockImplementation(function (
      this: HTMLInputElement,
      v: string
    ) {
      writes.push(`value=${v}`);
      valueDescriptor.set!.call(this, v);
    });
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name: string,
      v: string
    ) {
      if (this instanceof HTMLInputElement) writes.push(`${name}=${v}`);
      setAttribute.call(this, name, v);
    });

    let input!: HTMLInputElement;
    let setType!: (v: string) => string;
    const dispose = createRoot(dispose => {
      const [type, _setType] = createSignal("range");
      const [value] = createSignal("150");
      const [min] = createSignal(0);
      const [max] = createSignal(200);
      setType = _setType;
      input = (<input type={type()} value={value()} min={min()} max={max()} />) as HTMLInputElement;
      return dispose;
    });
    flush();
    expect(writes).toEqual(["type=range", "value=150", "min=0", "max=200"]);
    expect(input.type).toBe("range");

    // a type change re-runs only the bindings before `value`
    writes.length = 0;
    setType("number");
    flush();
    expect(writes).toEqual(["type=number"]);
    dispose();
  });
});
