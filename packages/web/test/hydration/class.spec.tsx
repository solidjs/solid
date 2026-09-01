/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hydrate } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

describe("class hydration", () => {
  const container = document.createElement("div");
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    container.innerHTML = "";
  });

  test("updates an object value after an in-place mutation", () => {
    const classes = { before: true, after: false };
    const [value, setValue] = createSignal(classes, { equals: false });
    container.innerHTML = '<div class="before" _hk="0"></div>';

    dispose = hydrate(() => <div class={value()} />, container);
    const element = container.firstElementChild as HTMLDivElement;
    element.classList.add("external");

    classes.before = false;
    classes.after = true;
    setValue(classes);
    flush();

    expect(element.className).toBe("external after");
  });
});
