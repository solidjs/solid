/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";

describe("dynamic select multiple (#3179)", () => {
  test("initially true dynamic multiple preserves statically selected options", () => {
    const [multiple] = createSignal(true);

    const select = createRoot(
      () =>
        (
          <select multiple={multiple()}>
            <option value="a" selected>
              A
            </option>
            <option value="b" selected>
              B
            </option>
          </select>
        ) as unknown as HTMLSelectElement
    );
    flush();

    expect(select.multiple).toBe(true);
    expect(Array.from(select.options, option => option.selected)).toEqual([true, true]);
  });

  test("initially false dynamic multiple keeps single-select semantics", () => {
    const [multiple] = createSignal(false);

    const select = createRoot(
      () =>
        (
          <select multiple={multiple()}>
            <option value="a" selected>
              A
            </option>
            <option value="b" selected>
              B
            </option>
          </select>
        ) as unknown as HTMLSelectElement
    );
    flush();

    expect(select.multiple).toBe(false);
    expect(Array.from(select.options, option => option.selected)).toEqual([false, true]);
  });

  test("a later toggle to multiple keeps the live selection state", () => {
    const [multiple, setMultiple] = createSignal(false);

    const select = createRoot(
      () =>
        (
          <select multiple={multiple()}>
            <option value="a" selected>
              A
            </option>
            <option value="b" selected>
              B
            </option>
          </select>
        ) as unknown as HTMLSelectElement
    );
    flush();

    expect(Array.from(select.options, option => option.selected)).toEqual([false, true]);

    // Toggling the attribute on later behaves like toggling it on static
    // markup: the browser keeps the current selection, nothing is restored.
    setMultiple(true);
    flush();

    expect(select.multiple).toBe(true);
    expect(Array.from(select.options, option => option.selected)).toEqual([false, true]);
  });

  test("toggling multiple off and back on does not resurrect deselected defaults", () => {
    const [multiple, setMultiple] = createSignal(true);

    const select = createRoot(
      () =>
        (
          <select multiple={multiple()}>
            <option value="a" selected>
              A
            </option>
            <option value="b" selected>
              B
            </option>
          </select>
        ) as unknown as HTMLSelectElement
    );
    flush();

    expect(Array.from(select.options, option => option.selected)).toEqual([true, true]);

    // Simulate the user clearing a default selection.
    select.options[0].selected = false;

    setMultiple(false);
    flush();
    setMultiple(true);
    flush();

    expect(Array.from(select.options, option => option.selected)).toEqual([false, true]);
  });
});
