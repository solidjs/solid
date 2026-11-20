/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5098: a list's async derive re-runs in the same flush, the list replaces
// the row, and the outgoing row's ref reads `props.entry.content` while the
// re-ask is pending. A ref is imperative, like an event handler: it reads the
// screen (the committed value) instead of throwing NotReadyError.
import { expect, test } from "vitest";
import { For, Show, createEffect, createSignal, createStore, flush } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#5098: a ref reading its row's store data does not throw while the list re-derives", async () => {
  const seen: string[] = [];
  const [wanted, setWanted] = createSignal(0);
  const Row = (props: { entry: { content: string } }) => (
    <Show when={wanted() === 1}>
      <div
        ref={el => {
          try {
            el.title = props.entry.content;
            seen.push(el.title);
          } catch (error: any) {
            seen.push(error.constructor.name);
          }
        }}
      />
    </Show>
  );
  function App() {
    createEffect(
      () => "view",
      () => {
        setWanted(1);
      }
    );
    const [page] = createStore(
      async (draft: any) => {
        draft.rows = [{ id: "a", content: "body" + wanted() }];
      },
      { rows: [] as { id: string; content: string }[] }
    );
    return <For each={page.rows}>{entry => <Row entry={entry} />}</For>;
  }
  const c = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <App />, c);
  await tick();
  expect(seen).toEqual(["body0", "body1"]);
  expect(c.innerHTML).toBe('<div title="body1"></div>');
  dispose();
  c.remove();
});
