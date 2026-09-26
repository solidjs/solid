/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for solidjs/solid#3666: an async `dynamic()` source inside a
 * `<Loading>` boundary. Two variants:
 *
 *  - inline: the source settles on a microtask, so the boundary settles
 *    BEFORE the shell flushes — the `<article>` is inline in the shell, no
 *    fallback is ever written, and the `_fr` record ships pre-resolved.
 *  - streamed: the source takes a timer, so the fallback flushes into the
 *    shell and the `<article>` arrives as a late fragment.
 *
 * Either way the client must adopt the resolved element (same node) and
 * never try to claim the fallback against it.
 *
 * Shared by test/server/dynamic-async-loading-3666.spec.tsx (ssr generate,
 * writes the artifacts) and test/hydration/dynamic-async-loading-3666
 * .spec.tsx (dom generate, replays them).
 */
import { createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const control = {
  inline: (): Promise<"article"> => Promise.resolve("article" as const),
  streamed: async (): Promise<"article"> => {
    await sleep(5);
    return "article" as const;
  }
};

function makeApp(source: () => Promise<"article">) {
  return function App() {
    const [count, setCount] = createSignal(0);
    const Content = dynamic(() => source());
    return (
      <Loading fallback={<main id="fallback">Loading…</main>}>
        <Content id="content">
          <button id="counter" onClick={() => setCount(count() + 1)}>
            Count: {count()}
          </button>
        </Content>
      </Loading>
    );
  };
}

export const variants = [
  {
    name: "dynamic-async-loading-3666-inline",
    App: makeApp(() => control.inline()),
    streams: false
  },
  {
    name: "dynamic-async-loading-3666-streamed",
    App: makeApp(() => control.streamed()),
    streams: true
  }
] as const;
