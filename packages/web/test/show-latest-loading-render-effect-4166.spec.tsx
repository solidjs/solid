/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4166: a `<Loading>` that `<Show when={latest(n) > 0}>` mounts during a
 * held action holds its content's text binding like a direct read (#3851):
 * the boundary shows its fallback beside the committed `n` until the action
 * lands.
 */
import { expect, test } from "vitest";
import { Loading, Show, action, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

test("a verdict-mounted Loading holds its content's binding until the action lands (#4166)", async () => {
  const root = document.createElement("div");
  const [n, setN] = createSignal(0);
  let release!: () => void;
  const save = action(function* () {
    setN(1);
    yield new Promise<void>(r => (release = r));
  });

  const dispose = render(
    () => (
      <>
        <i>{n()}</i>
        <Show when={latest(n) > 0}>
          <Loading fallback="pending">
            <p>{n()}</p>
          </Loading>
        </Show>
      </>
    ),
    root
  );
  flush();
  expect(root.innerHTML).toBe("<i>0</i>");

  const done = save();
  await settle();
  expect(root.innerHTML).toBe("<i>0</i>pending");

  release();
  await done;
  await settle();
  expect(root.innerHTML).toBe("<i>1</i><p>1</p>");
  dispose();
});
