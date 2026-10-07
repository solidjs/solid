/**
 * @jsxImportSource @solidjs/web
 *
 * The page the generic (frames-free) hydration consistency pins and harness
 * drive — `documentation/server-components/frames-consistency-contract.md`
 * §"Generic hydration". Plain Solid 2: a shell and two sibling streamed
 * `<Loading>` boundaries, each reading
 *
 *  - a plain signal (`path`) created OUTSIDE any hydration root — module-level
 *    state, the shape of a global store module (snapshot-capturable on its
 *    first write during hydration, #3504);
 *  - a memo derived from it (`label`) under its own root, created BEFORE
 *    `hydrate()` — so it is in no hydration root's snapshot scope and has no
 *    creation-time snapshot;
 *  - a module-level store list rendered by `<For>` (structural writes);
 *  - a shell async memo (`shared`) that depends on `path` and is read ONLY
 *    inside the boundaries — pending when the shell flushes, so the client
 *    adopts it as a pending answer (no creation-time snapshot) and it lands
 *    with the first fragment;
 *  - an async memo of its own (what keeps each boundary pending on the
 *    server; `order` decides which fragment the server flushes first).
 *
 * The server half (test/server/generic-hydration.gen.spec.tsx) renders both
 * orders and writes `__artifacts__/generic-hydration-<order>.json`
 * (`{ shell, chunks }`); the client half replays the chunks under a schedule
 * it controls (write / dispose / tick between them).
 */
import { createMemo, createRoot, createSignal, createStore, Loading } from "solid-js";
import { For } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Order = "ab" | "ba";

export interface GenericApp {
  App: () => any;
  /** Client write to the module-level signal. */
  setPath: (p: string) => void;
  path: () => string;
  /** The module-level memo derived from `path`. */
  label: () => string;
  store: { items: string[] };
  /** Append one item to the module-level store list. */
  pushItem: (item: string) => void;
  /** Click handler log: the boundary name of each button clicked. */
  clicks: string[];
  /** `Side` component bodies run, by boundary name (one per mount). */
  invocations: string[];
  /** The shell's `shared` memo, once `App` has rendered (undefined before). */
  shared: () => (() => string) | undefined;
}

export function createGenericApp(order: Order): GenericApp {
  const [path, setPath] = createSignal("/a", { ownedWrite: true });
  const label = createRoot(() => createMemo(() => "label:" + path()));
  const [store, setStore] = createStore<{ items: string[] }>({ items: ["i0", "i1"] });
  const clicks: string[] = [];
  const invocations: string[] = [];
  let shared: (() => string) | undefined;

  function Side(props: { name: string; delay: number; shared: () => string }) {
    invocations.push(props.name);
    const data = createMemo(async () => {
      await sleep(props.delay);
      return "data:" + props.name;
    });
    return (
      <section class={props.name}>
        <span class="data">{data()}</span>
        <span class="raw">{path()}</span>
        <span class="label">{label()}</span>
        <span class="shared">{props.shared()}</span>
        <ul>
          <For each={store.items}>{item => <li>{item}</li>}</For>
        </ul>
        <button onClick={() => clicks.push(props.name)}>b</button>
      </section>
    );
  }

  function App() {
    // Pending when the shell flushes (read only under the boundaries), lands
    // on the client with the first fragment's chunk.
    const sharedMemo = createMemo(async () => {
      const p = path();
      await sleep(15);
      return "shared:" + p;
    });
    shared = sharedMemo;
    return (
      <main>
        <h1>{label()}</h1>
        <h2>{path()}</h2>
        <Loading fallback={<p class="fb a">a-loading</p>}>
          <Side name="a" delay={order === "ab" ? 5 : 40} shared={sharedMemo} />
        </Loading>
        <Loading fallback={<p class="fb b">b-loading</p>}>
          <Side name="b" delay={order === "ab" ? 40 : 5} shared={sharedMemo} />
        </Loading>
      </main>
    );
  }

  return {
    App,
    setPath,
    path,
    label,
    store,
    pushItem: item =>
      setStore(s => {
        s.items.push(item);
      }),
    clicks,
    invocations,
    shared: () => shared
  };
}
