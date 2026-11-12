/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { className, render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

describe("class", () => {
  test("updates an object value after an in-place mutation", () => {
    const classes = { before: true, after: false };
    const [value, setValue] = createSignal(classes, { equals: false });
    const container = document.createElement("div");
    const dispose = render(() => <div class={value()} />, container);
    const element = container.firstElementChild as HTMLDivElement;

    expect(element.className).toBe("before");
    element.classList.add("external");

    classes.before = false;
    classes.after = true;
    setValue(classes);
    flush();

    expect(element.className).toBe("external after");
    dispose();
  });

  test("resets the applied snapshot when switching value forms", () => {
    const [value, setValue] = createSignal<string | Record<string, boolean> | null>({
      first: true
    });
    const container = document.createElement("div");
    const dispose = render(() => <div class={value()} />, container);
    const element = container.firstElementChild as HTMLDivElement;

    setValue("second");
    flush();
    expect(element.className).toBe("second");

    setValue({ third: true });
    flush();
    expect(element.className).toBe("third");

    setValue(null);
    flush();
    expect(element.hasAttribute("class")).toBe(false);
    dispose();
  });

  test("a string value drops the applied snapshot of an earlier object value", () => {
    const element = document.createElement("div");
    className(element, { a: true });
    className(element, "a b");
    className(element, { c: true });
    expect(element.className).toBe("a b c");
  });

  test("a string value stores nothing on an element that never had an object value", () => {
    const [value, setValue] = createSignal("first");
    const container = document.createElement("div");
    const dispose = render(() => <div class={value()} />, container);
    const element = container.firstElementChild as HTMLDivElement;

    setValue("second");
    flush();
    expect(element.className).toBe("second");
    expect(Object.hasOwn(element, "_$classes")).toBe(false);
    dispose();
  });
});
