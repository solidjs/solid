/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { Show, action, createMemo, createOptimistic, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";
import type { JSX } from "@solidjs/web";

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

// #3835: an element an optimistic guess mounts lands with its bindings. Its
// style reads a signal the action holds, so it shows the committed value
// until the action lands — with or without a memo around the element.
for (const shape of ["memo", "no memo", "memo, static text"] as const) {
  test(`an optimistically mounted element lands with its style (${shape}, #3835)`, async () => {
    const root = document.createElement("div");
    const [enabled, setEnabled] = createSignal(false);
    const [visible, setVisible] = createOptimistic(enabled);
    let release!: () => void;
    const run = action(function* () {
      setEnabled(true);
      setVisible(true);
      yield new Promise<void>(r => (release = r));
    });

    function Content(props: { enabled: () => boolean }): JSX.Element {
      if (shape === "no memo")
        return (
          <div style={{ color: props.enabled() ? "blue" : "red" }}>
            Hello{props.enabled() ? " world" : ""}
          </div>
        );
      if (shape === "memo, static text")
        return createMemo(() => (
          <div style={{ color: props.enabled() ? "blue" : "red" }}>Hello world</div>
        )) as unknown as JSX.Element;
      return createMemo(() => (
        <div style={{ color: props.enabled() ? "blue" : "red" }}>
          Hello{props.enabled() ? " world" : ""}
        </div>
      )) as unknown as JSX.Element;
    }

    const dispose = render(
      () => (
        <Show when={visible()}>
          <Content enabled={enabled} />
        </Show>
      ),
      root
    );
    flush();
    expect(root.innerHTML).toBe("");

    const pending = run();
    flush();
    await settle();
    const div = root.querySelector("div")!;
    expect(div.style.color).toBe("red");
    expect(div.textContent).toBe(shape === "memo, static text" ? "Hello world" : "Hello");

    release();
    await pending;
    await settle();
    expect(root.querySelector("div")).toBe(div);
    expect(div.style.color).toBe("blue");
    expect(div.textContent).toBe("Hello world");
    dispose();
  });
}
