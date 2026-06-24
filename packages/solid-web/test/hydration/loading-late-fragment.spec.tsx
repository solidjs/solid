/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression test: a <Loading> boundary whose streamed fragment arrives AFTER
 * the shell has hydrated (chained async memos whose serialized values are not
 * in the shell) must claim the late-streamed server node, not orphan it.
 *
 * Root cause: when a chained async memo (e.g. `b = createMemo(() => fetchItems(m()))`
 * where `m` reads a pending async memo `a`) recomputes after `sharedConfig.hydrating`
 * flips to false but before the boundary's fragment resume fires, the memo's
 * `readSerializedOrCompute` would re-run its compute function (e.g. `fetchItems(...)`)
 * instead of subscribing to the server's serialized deferred Promise. The new
 * client-side Promise resolves after the resume window closes, so the For renders
 * with `hydrating=false` and creates a fresh node — orphaning the server fragment
 * that `$df` swapped in.
 *   "Hydration completed with 1 unclaimed server-rendered node(s):
 *    <div _hk="...">item 1</div>"
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, flush, Loading } from "solid-js";
import { For, hydrate } from "@solidjs/web";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fetchItems = async (id: number) => {
  await sleep(10);
  return ["item " + id];
};

// Streamed chunks for `<Home />` with sleep(1000)-equivalent timing:
//   shell  : boundary fallback + pending `3_fr` + pending `0` (a). key `2` (b)
//            is NOT registered yet (b only serializes after a resolves).
//   mid    : defines the resolver, resolves `0` -> [1], registers `2` (pending).
//   late   : `<template id="3">` + `$df("3")` swap + resolves `2` and `3_fr`.
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

describe("Loading boundary — late-streamed fragment hydration (chained async memos)", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await new Promise(r => setTimeout(r, 0));
    setupHydration();
    container.innerHTML = "";
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

  test("streamed fragment is claimed on resume (no orphan)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 1. shell (boundary fallback + pending 3_fr; b's key "2" not registered yet)
    applyChunk(container, SHELL, true);
    // 2. hydrate against the shell while the boundary fragment is still pending
    dispose = hydrate(() => <Home />, container);
    await Promise.resolve();
    flush();
    // 3. mid chunk: a resolves, b registered (pending)
    applyChunk(container, MID, false);
    await Promise.resolve();
    flush();
    // 4. late chunk: template + $df swap + resolve b and 3_fr
    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    await new Promise(r => setTimeout(r, 50));

    // The server-rendered <div _hk=300000> should be claimed, not duplicated.
    expect(container.querySelectorAll("div").length).toBe(1);
    expect(container.textContent).toBe("item 1");

    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
  });
});
