/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4340: #4203 with a memo between the written signal and the pending memo.
 * A `<Loading>` that a keyed `<Show when={latest(value) ?? value()}>`
 * mounts reveals its content when a component inside it writes an
 * `ownedWrite` signal during its mount, derives `gate` from it, and creates
 * a memo over `gate` that never settles. Nothing reads that memo: a pending
 * value no render effect reaches holds nothing and reaches no boundary.
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

test("an unread pending memo behind a memo does not hold a latest()-mounted Loading (#4340)", async () => {
  const root = document.createElement("div");
  function Child() {
    const [version, setVersion] = createSignal(0, { ownedWrite: true });
    setVersion(1);
    const gate = createMemo(() => version());
    createMemo(() => (gate(), new Promise(() => {})));
    return <p>child</p>;
  }

  const dispose = render(() => {
    const value = createMemo(async () => "v");
    return (
      <Loading fallback={<p>outer</p>}>
        <Show when={latest(value) ?? value()} keyed>
          {_value => (
            <Loading fallback={<p>inner</p>}>
              <Child />
            </Loading>
          )}
        </Show>
      </Loading>
    );
  }, root);
  await settle();
  expect(root.textContent).toBe("child");
  dispose();
});
