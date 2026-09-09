/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";

describe("iterable children hydration", () => {
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

  test("adopts server-rendered iterable children", async () => {
    const values = new Set(["before", "after"]);
    // Captured from renderToString(() => <div>{values}</div>).
    container.innerHTML = '<div _hk="0">before<!--!$-->after</div>';
    const element = container.firstElementChild!;
    const firstText = element.childNodes[0];
    const secondText = element.childNodes[2];

    dispose = hydrate(() => <div>{values}</div>, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();

    expect(element.textContent).toBe("beforeafter");
    expect(element.childNodes[0]).toBe(firstText);
    expect(element.childNodes[1]).toBe(secondText);
  });
});
