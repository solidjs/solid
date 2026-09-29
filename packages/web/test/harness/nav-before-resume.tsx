/**
 * @jsxImportSource @solidjs/web
 *
 * A router-shaped page for "navigate while an SSR-streamed
 * boundary is still pending". Compiled with both generates: the server
 * spec (test/server/nav-before-resume.gen.spec.tsx) writes the chunks the
 * client spec (test/hydration/nav-before-resume.spec.tsx) replays.
 *
 *  - `title`: shell-level async memo keyed on the location (layout data).
 *  - `label`: shell-level sync memo keyed on the location.
 *  - `<Side>`: a slow streamed boundary OUTSIDE the route outlet; it reads a
 *    library keyed value at resume (the #2964 late-boundary adoption shape).
 *  - `<RouteA>`: the initial route, with its own streamed boundary that is
 *    still pending when the client navigates away.
 *  - `<RouteB>`: the navigation target, rendered fresh.
 */
import { createMemo, createSignal, Loading, onSettled, Show } from "solid-js";
import { getHydrationWriter, isServer, takeHydrationValue } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type NavHooks = {
  settled?: () => void;
  sideTaken?: (v: unknown) => void;
  bRendered?: () => void;
};

export function createNavApp(hooks: NavHooks = {}) {
  const [path, setPath] = createSignal("/a", { ownedWrite: true });

  function Side() {
    const data = createMemo(async () => {
      await sleep(60);
      return "side-data";
    });
    if (isServer) getHydrationWriter()?.write("lib:side", { n: 42 });
    else hooks.sideTaken?.(takeHydrationValue("lib:side"));
    return <aside>{data()}</aside>;
  }

  function RouteA() {
    const d = createMemo(async () => {
      await sleep(20);
      return "a-data";
    });
    return (
      <section>
        <Loading fallback={<i>a-loading</i>}>
          <b>{d()}</b>
        </Loading>
      </section>
    );
  }

  function RouteB() {
    hooks.bRendered?.();
    return (
      <section>
        <em>page b</em>
      </section>
    );
  }

  function App() {
    const title = createMemo(async () => {
      const p = path();
      await sleep(1);
      return "title:" + p;
    });
    const label = createMemo(() => "label:" + path());
    onSettled(() => {
      hooks.settled?.();
    });
    return (
      <main>
        <h1>{title()}</h1>
        <h2>{label()}</h2>
        <Loading fallback={<p>side-loading</p>}>
          <Side />
        </Loading>
        <Show when={path() === "/a"} fallback={<RouteB />}>
          <RouteA />
        </Show>
      </main>
    );
  }

  return { App, navigate: (p: string) => setPath(p) };
}
