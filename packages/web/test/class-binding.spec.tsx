/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";

describe("class primitive values (#3189)", () => {
  test("dynamic numeric class matches the static form", () => {
    createRoot(() => {
      const [value] = createSignal(1);
      const staticClass = (<div class={1} />) as unknown as HTMLDivElement;
      const dynamicClass = (<div class={value()} />) as unknown as HTMLDivElement;
      flush();
      expect(staticClass.getAttribute("class")).toBe("1");
      expect(dynamicClass.getAttribute("class")).toBe("1");
    });
  });

  test("dynamic zero class matches the static form", () => {
    createRoot(() => {
      const [value] = createSignal(0);
      const staticClass = (<div class={0} />) as unknown as HTMLDivElement;
      const dynamicClass = (<div class={value()} />) as unknown as HTMLDivElement;
      flush();
      expect(staticClass.getAttribute("class")).toBe("0");
      expect(dynamicClass.getAttribute("class")).toBe("0");
    });
  });

  test("dynamic numeric class updates", () => {
    let div!: HTMLDivElement;
    let setValue!: (v: number) => number;
    createRoot(() => {
      const [value, _setValue] = createSignal(1);
      setValue = _setValue;
      div = (<div class={value()} />) as unknown as HTMLDivElement;
    });
    flush();
    expect(div.getAttribute("class")).toBe("1");
    setValue(2);
    flush();
    expect(div.getAttribute("class")).toBe("2");
  });

  test("standalone booleans in arrays are ignored", () => {
    createRoot(() => {
      const div = (<div class={[true, false, "active"]} />) as unknown as HTMLDivElement;
      expect(div.className).toBe("active");
    });
  });

  test("numbers in arrays still become classes", () => {
    createRoot(() => {
      const div = (<div class={[0, 1, "active"]} />) as unknown as HTMLDivElement;
      expect(div.classList.contains("0")).toBe(true);
      expect(div.classList.contains("1")).toBe(true);
      expect(div.classList.contains("active")).toBe(true);
    });
  });
});
