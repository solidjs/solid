/**
 * @jsxImportSource @solidjs/web
 *
 * #4807: two sibling `<Loading>` boundaries after an element, all under one
 * parent. `a` answers before `b`, so the server streams a's fragment, then
 * b's. `parent` is what wraps the three siblings; `show-tail` adds an element
 * after the `<Show>`, so its hole is marker-bounded; `lead-show` adds one
 * before it.
 */
import { createMemo, Errored, Loading, Show } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const parents = ["errored", "show", "show-tail", "lead-show", "loading", "div"] as const;
export type Parent = (typeof parents)[number];

export function createSiblingLoadingApp(parent: Parent) {
  function App() {
    const a = createMemo(async () => (await sleep(10), 1));
    const b = createMemo(async () => (await sleep(60), 2));
    const A = () => (
      <Loading fallback={<p>loading a</p>}>
        <p>a {a()}</p>
      </Loading>
    );
    const B = () => (
      <Loading fallback={<p>loading b</p>}>
        <p>b {b()}</p>
      </Loading>
    );
    if (parent === "errored")
      return (
        <main>
          <Errored fallback={<p>failed</p>}>
            <p>head</p>
            <A />
            <B />
          </Errored>
        </main>
      );
    if (parent === "show")
      return (
        <main>
          <Show when={true}>
            <p>head</p>
            <A />
            <B />
          </Show>
        </main>
      );
    if (parent === "show-tail")
      return (
        <main>
          <Show when={true}>
            <p>head</p>
            <A />
            <B />
          </Show>
          <p>tail</p>
        </main>
      );
    if (parent === "lead-show")
      return (
        <main>
          <p>lead</p>
          <Show when={true}>
            <p>head</p>
            <A />
            <B />
          </Show>
        </main>
      );
    if (parent === "loading")
      return (
        <main>
          <Loading fallback={<p>outer</p>}>
            <p>head</p>
            <A />
            <B />
          </Loading>
        </main>
      );
    return (
      <main>
        <div>
          <p>head</p>
          <A />
          <B />
        </div>
      </main>
    );
  }
  return { App };
}
