/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for solidjs/solid#3950: a streamed `<Loading>` whose content
 * renders a store array through `<For>` and, from `onSettled`, removes the
 * first row — the "render what the server rendered, then switch to the
 * client value" pattern `isHydrating()` documents. Compiled with both
 * generates: test/server/onsettled-store-write-3950.gen.spec.tsx writes the
 * chunks test/hydration/onsettled-store-write-3950.spec.tsx replays.
 */
import { createStore, For, Loading, onSettled, reconcile } from "solid-js";

type Item = { id: string; label: string };
type State = { items: Item[] };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function createApp(write: (state: State) => void) {
  return function App() {
    const [state, setState] = createStore<State>(
      async () => {
        await sleep(20);
        return {
          items: [
            { id: "a", label: "remove" },
            { id: "b", label: "keep" }
          ]
        };
      },
      { items: [] }
    );
    function Content() {
      onSettled(() => setState(write));
      return (
        <ul>
          <For each={state.items}>{item => <li>{item.label}</li>}</For>
        </ul>
      );
    }
    return (
      <main>
        <Loading fallback={<p>pending</p>}>
          <Content />
        </Loading>
      </main>
    );
  };
}

export const variants = [
  {
    name: "onsettled-store-write-3950-splice",
    App: createApp(s => {
      s.items.splice(0, 1);
    })
  },
  {
    name: "onsettled-store-write-3950-reconcile",
    App: createApp(s => reconcile({ items: s.items.slice(1) }, "id")(s))
  }
] as const;
