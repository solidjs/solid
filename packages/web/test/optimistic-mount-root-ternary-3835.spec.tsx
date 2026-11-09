/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3835 at a component root: `<>{visible() ? <b>child</b> : undefined}</>`
 * compiles to a memo whose pass creates its own truthiness memo. An action's
 * guess opens the branch at once, like `<Show>` and the same ternary inside
 * an element.
 */
import { expect, test } from "vitest";
import { Show, action, createOptimistic, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

for (const shape of ["Show", "root ternary", "ternary in an element", "&&"] as const)
  test(`a guess opens the branch (${shape}, #3835)`, async () => {
    const root = document.createElement("div");
    const [enabled, setEnabled] = createSignal(false);
    const [visible, setVisible] = createOptimistic(enabled);
    let release!: () => void;
    const run = action(function* () {
      setEnabled(true);
      setVisible(true);
      yield new Promise<void>(r => (release = r));
    });
    const dispose = render(
      () =>
        shape === "Show" ? (
          <Show when={visible()}>
            <b>child</b>
          </Show>
        ) : shape === "root ternary" ? (
          <>{visible() ? <b>child</b> : undefined}</>
        ) : shape === "&&" ? (
          <p>{visible() && <b>child</b>}</p>
        ) : (
          <p>{visible() ? <b>child</b> : undefined}</p>
        ),
      root
    );
    flush();
    const frames = [root.textContent];
    const pending = run();
    flush();
    await settle();
    frames.push(root.textContent);
    release();
    await pending;
    await settle();
    frames.push(root.textContent);
    dispose();
    expect(frames).toEqual(["", "child", "child"]);
  });
