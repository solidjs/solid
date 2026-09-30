/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A `class` object value may be `undefined` — an optional prop passed straight
// through, `class={{ active: props.active }}` — as 1.x `classList` allowed.
// The runtime treats it as off; `test-types` pins the type and this pins the
// toggle.
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

describe("class object values", () => {
  test("an undefined value is off", () => {
    const [active, setActive] = createSignal<boolean | undefined>(true);
    const container = document.createElement("div");
    const dispose = render(() => <div class={{ item: true, active: active() }} />, container);
    const element = container.firstElementChild as HTMLDivElement;

    expect(element.className).toBe("item active");

    setActive(undefined);
    flush();
    expect(element.className).toBe("item");
    dispose();
  });
});
