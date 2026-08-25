/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression: a chained async memo must not run real client work (and must not
 * orphan/duplicate the server fragment) when it recomputes between a streamed
 * <Loading> section's chunks.
 *
 * `a` (async) is serialized as a deferred Promise; `b = createMemo(() => fetchItems(m()))`
 * depends on it through `m`. On the client, when `a` resolves from its serialized
 * value, `b` recomputes — but that recompute lands *between* boundary-resume
 * windows, where the per-pass `sharedConfig.hydrating` flag is false. The
 * computation is still hydrating (its serialized value `"2"` is unconsumed and
 * hydration is not `done`), so it must short-circuit to the server's serialized
 * Promise instead of running a fresh `fetchItems(...)`. Otherwise the fresh
 * client Promise resolves after the resume window closes, <For> renders a fresh
 * node, and the server-streamed fragment is orphaned (duplicated in prod, dev
 * warns: "unclaimed server-rendered node").
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, flush, Loading } from "solid-js";
import { For, hydrate } from "@solidjs/web";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Real client fetches are counted here. `subFetch` swaps `window.fetch` for a
// mock during dep-collection, so this spy only fires if the body performed real
// client work — i.e. the short-circuit did NOT engage.
let realFetchCalls = 0;
(globalThis as any).fetch = async () => {
  realFetchCalls++;
  return { ok: true };
};
const fetchItems = async (id: number) => {
  await fetch("/items/" + id);
  return ["item " + id];
};

// Streamed chunks for `<Home/>`:
//   shell : boundary fallback + pending `3_fr` + pending `0` (a). `b`'s key `2`
//           is not registered yet (it serializes only after `a` resolves).
//   mid   : resolves `0` -> [1] and registers `2` (pending).
//   late  : <template id="3"> + $df swap + resolves `2` and `3_fr`.
const RESOLVER_FN =
  "($R[6]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })";
const DEFERRED =
  "($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })";

const SHELL =
  `<template id="pl-3"></template><div _hk=30>loading</div><!--pl-3-->` +
  `<script>(self.$R=self.$R||{})[""]=[];` +
  `_$HY.r["0"]=$R[0]=($R[1]=${DEFERRED}()).p;` +
  `_$HY.r["3_fr"]=$R[3]=($R[4]=${DEFERRED}()).p;` +
  `</script>`;

const MID =
  `<script>${RESOLVER_FN}($R[1],$R[5]=[1]);` +
  `_$HY.r["2"]=$R[7]=($R[8]=${DEFERRED}()).p;` +
  `</script>`;

const LATE_TEMPLATE = `<template id="3"><div _hk=300000>item 1</div></template>`;

const LATE_SCRIPT =
  `<script>$R[6]($R[8],$R[9]=["item 1"]);$df("3");` +
  `function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}` +
  `;$R[6]($R[4],!0);</script>`;

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

describe("Loading boundary — late-streamed fragment (chained async memos)", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await new Promise(r => setTimeout(r, 0));
    setupHydration();
    container.innerHTML = "";
    realFetchCalls = 0;
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  function Home() {
    const a = createMemo(async () => {
      await sleep(10);
      return [1];
    });
    const m = createMemo(() => a()[0]);
    const b = createMemo(() => fetchItems(m()));
    return (
      <Loading fallback={<div>loading</div>}>
        <For each={b()}>{x => <div>{x}</div>}</For>
      </Loading>
    );
  }

  test("claims the streamed fragment, no duplicate, no client work", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyChunk(container, SHELL, true);
    dispose = hydrate(() => <Home />, container);
    await Promise.resolve();
    flush();
    applyChunk(container, MID, false);
    await Promise.resolve();
    flush();
    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    await new Promise(r => setTimeout(r, 50));

    // server fragment claimed, not duplicated
    expect(container.querySelectorAll("div").length).toBe(1);
    expect(container.textContent).toBe("item 1");
    // cause is fixed: the memo short-circuited to the server value, so no real
    // client fetch ran during hydration
    expect(realFetchCalls).toBe(0);

    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
  });
});
