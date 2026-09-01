/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3182: direct `value`/`checked` bindings must adopt the live DOM state
 * during hydration instead of clobbering it. The user may have interacted
 * with a server-rendered form control before the client bundle hydrated;
 * the initial claim pass must preserve that state, and the first real
 * reactive update afterwards applies the client value.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

describe("#3182: stateful DOM properties during hydration", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await new Promise(r => setTimeout(r, 0));
    setupHydration();
    container.innerHTML = "";
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("direct value binding preserves pre-hydration user input", () => {
    container.innerHTML = '<input _hk="0" value="server">';
    const input = container.firstElementChild as HTMLInputElement;

    // Simulate the user typing before the client bundle hydrates.
    input.value = "user";

    let setValue!: (v: string) => void;
    dispose = hydrate(() => {
      const [value, _setValue] = createSignal("server");
      setValue = _setValue;
      return <input value={value()} />;
    }, container);

    expect(container.firstElementChild).toBe(input);
    expect(input.value).toBe("user");

    // The first subsequent reactive update applies the signal value.
    setValue("updated");
    flush();
    expect(input.value).toBe("updated");
  });

  test("direct checked binding preserves pre-hydration user toggle", () => {
    container.innerHTML = '<input _hk="0" type="checkbox" checked>';
    const input = container.firstElementChild as HTMLInputElement;

    // Simulate a user interaction before hydration.
    input.checked = false;

    let setChecked!: (v: boolean) => void;
    dispose = hydrate(() => {
      const [checked, _setChecked] = createSignal(true);
      setChecked = _setChecked;
      return <input type="checkbox" checked={checked()} />;
    }, container);

    expect(container.firstElementChild).toBe(input);
    expect(input.checked).toBe(false);

    // A real signal change (true -> false -> true) applies to the DOM. Note
    // that re-setting the signal to its current value is not an update in
    // fine-grained reactivity, so the write only happens on actual change.
    setChecked(false);
    flush();
    expect(input.checked).toBe(false);
    setChecked(true);
    flush();
    expect(input.checked).toBe(true);
  });

  test("textarea value binding preserves pre-hydration user input", () => {
    container.innerHTML = '<textarea _hk="0">server</textarea>';
    const area = container.firstElementChild as HTMLTextAreaElement;

    area.value = "user";

    let setValue!: (v: string) => void;
    dispose = hydrate(() => {
      const [value, _setValue] = createSignal("server");
      setValue = _setValue;
      return <textarea value={value()} />;
    }, container);

    expect(container.firstElementChild).toBe(area);
    expect(area.value).toBe("user");

    setValue("updated");
    flush();
    expect(area.value).toBe("updated");
  });

  test("select value binding preserves pre-hydration user selection", async () => {
    container.innerHTML =
      '<select _hk="0"><option value="a" selected>a</option><option value="b">b</option><option value="c">c</option></select>';
    const select = container.firstElementChild as HTMLSelectElement;

    select.value = "b";

    let setValue!: (v: string) => void;
    dispose = hydrate(() => {
      const [value, _setValue] = createSignal("a");
      setValue = _setValue;
      return (
        <select value={value()}>
          <option value="a">a</option>
          <option value="b">b</option>
          <option value="c">c</option>
        </select>
      );
    }, container);

    // select value writes defer through a microtask
    await new Promise(r => setTimeout(r, 0));
    expect(container.firstElementChild).toBe(select);
    expect(select.value).toBe("b");

    // A real signal change applies to the DOM.
    setValue("c");
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(select.value).toBe("c");
  });

  test("post-hydration renders still apply value immediately (control)", () => {
    container.innerHTML = '<div _hk="0"></div>';
    dispose = hydrate(() => <div />, container);

    // Fresh client-side render after hydration completed: binding applies.
    const [value] = createSignal("client");
    const el = (<input value={value()} />) as HTMLInputElement;
    expect(el.value).toBe("client");
  });
});
