/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4203: a `<Loading>` that `<Show when={latest(gate) ?? gate()}>` mounts
 * reveals its content when a component inside it writes an `ownedWrite`
 * signal during its mount and then creates a memo that reads it and never
 * settles. Nothing reads the memo: a pending value no render effect
 * reaches holds nothing and reaches no boundary.
 */
import { expect, test } from "vitest";
import { Loading, Show, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

test("an unread pending memo does not hold a verdict-mounted Loading (#4203)", async () => {
  const root = document.createElement("div");
  function Child() {
    const [version, setVersion] = createSignal(0, { ownedWrite: true });
    setVersion(1);
    createMemo(() => {
      version();
      return new Promise(() => {});
    });
    return "CHILD";
  }

  const dispose = render(() => {
    const gate = createMemo(async () => "x");
    return (
      <Loading fallback="OUTER LOADING">
        <Show when={latest(() => gate()) ?? gate()}>
          <Loading fallback="INNER LOADING">
            <Child />
          </Loading>
        </Show>
      </Loading>
    );
  }, root);
  await settle();
  expect(root.innerHTML).toBe("CHILD");
  dispose();
});
