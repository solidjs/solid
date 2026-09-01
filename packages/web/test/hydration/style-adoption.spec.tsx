/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3180: reactive style bindings must preserve server-rendered styles during
 * the initial hydration pass, consistent with `class` and ordinary
 * attributes. The first subsequent reactive update applies the client value.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

describe("#3180: style bindings during hydration", () => {
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

  test("static-keyed style object preserves server styles (issue repro)", () => {
    container.innerHTML =
      '<div _hk="0" class="server" data-value="server" style="color:red"></div>';
    const div = container.firstElementChild as HTMLDivElement;

    let setValue!: (v: { token: string; color: string }) => void;
    dispose = hydrate(() => {
      const [value, _setValue] = createSignal({ token: "client", color: "blue" });
      setValue = _setValue;
      return (
        <div class={value().token} data-value={value().token} style={{ color: value().color }} />
      );
    }, container);

    expect(container.firstElementChild).toBe(div);
    // class and attribute already preserve the server DOM; style must match.
    expect(div.className).toBe("server");
    expect(div.getAttribute("data-value")).toBe("server");
    expect(div.style.color).toBe("red");

    // The first real reactive update applies the client values.
    setValue({ token: "updated", color: "green" });
    flush();
    expect(div.className).toBe("updated");
    expect(div.getAttribute("data-value")).toBe("updated");
    expect(div.style.color).toBe("green");
  });

  test("string style binding preserves server styles", () => {
    container.innerHTML = '<div _hk="0" style="color:red"></div>';
    const div = container.firstElementChild as HTMLDivElement;

    let setColor!: (v: string) => void;
    dispose = hydrate(() => {
      const [color, _setColor] = createSignal("blue");
      setColor = _setColor;
      return <div style={`color: ${color()}`} />;
    }, container);

    expect(container.firstElementChild).toBe(div);
    expect(div.style.color).toBe("red");

    setColor("green");
    flush();
    expect(div.style.color).toBe("green");
  });

  test("fully dynamic style object preserves server styles", () => {
    container.innerHTML = '<div _hk="0" style="color:red;font-weight:bold"></div>';
    const div = container.firstElementChild as HTMLDivElement;

    let setStyles!: (v: Record<string, string>) => void;
    dispose = hydrate(() => {
      const [styles, _setStyles] = createSignal<Record<string, string>>({
        color: "blue",
        "font-weight": "bold"
      });
      setStyles = _setStyles;
      return <div style={styles()} />;
    }, container);

    expect(container.firstElementChild).toBe(div);
    expect(div.style.color).toBe("red");
    expect(div.style.fontWeight).toBe("bold");

    // First update: changed property applies, dropped property is removed.
    setStyles({ color: "green" });
    flush();
    expect(div.style.color).toBe("green");
    expect(div.style.fontWeight).toBe("");
  });

  test("spread style object preserves server styles", () => {
    container.innerHTML = '<div _hk="0" style="color:red"></div>';
    const div = container.firstElementChild as HTMLDivElement;

    let setColor!: (v: string) => void;
    dispose = hydrate(() => {
      const [color, _setColor] = createSignal("blue");
      setColor = _setColor;
      return <div {...{ style: { color: color() } }} />;
    }, container);
    flush();

    expect(container.firstElementChild).toBe(div);
    expect(div.style.color).toBe("red");

    setColor("green");
    flush();
    expect(div.style.color).toBe("green");
  });

  test("post-hydration renders still apply styles immediately (control)", () => {
    container.innerHTML = '<div _hk="0"></div>';
    dispose = hydrate(() => <div />, container);

    const [color] = createSignal("blue");
    const el = (<div style={{ color: color() }} />) as HTMLDivElement;
    expect(el.style.color).toBe("blue");
    const el2 = (<div style={`color: ${color()}`} />) as HTMLDivElement;
    expect(el2.style.color).toBe("blue");
  });
});
