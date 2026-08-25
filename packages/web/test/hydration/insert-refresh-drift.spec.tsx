/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression (#2801 bug 1): an async value sitting directly beside siblings at
 * fragment root (`Count: {data()} <span/>` under <Loading>, no wrapping
 * element) drifted from the real DOM on post-hydration refresh — the update
 * appended a duplicate (`Count: 42 after43`) instead of replacing the text.
 *
 * Cause: while hydrating, `insertExpression` is a no-op but `insert` still
 * committed `current` from uncommitted renders. A settled boundary rendered
 * its fallback anyway (`current = [<p>]`, never in the DOM), so the content
 * pass couldn't reuse the claimed server text nodes and fabricated fresh
 * detached ones; every later update then reconciled against phantom nodes.
 *
 * Fixed for the settled case in `createLoadingBoundary`: a boundary whose
 * serialized state is already settled hydrates straight through to content —
 * the fallback only hydrates when it is actually what the server left showing.
 *
 * The genuinely-pending stream case (fallback correctly hydrates, then $df
 * swaps in the settled content) is covered by insert's swapped-region
 * re-claim: when a hole's tracked nodes are disconnected mid-hydration, the
 * insert re-derives them from the live DOM region so loose text can match
 * positionally (elements recover via _hk regardless).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, createSignal, flush, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DEFERRED =
  "($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })";
const RESOLVER_FN =
  "($R[5]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })";

// Captured from renderToStream of <Comp/> with the data already resolved
// (single chunk — the full-page-refresh scenario from the issue).
const SINGLE_CHUNK =
  `Count: <!--!$-->42<!--!$--> <span _hk=1001>after</span>` +
  `<script>(self.$R=self.$R||{})[""]=[];` +
  `_$HY.r["0"]=$R[0]=($R[1]=${DEFERRED}()).p;` +
  `_$HY.r["1_fr"]=$R[3]=($R[4]=$R[2]()).p;` +
  `${RESOLVER_FN}($R[1],42);$R[5]($R[4],!0);</script>`;

// Captured from renderToStream with late-resolving data (fallback shell,
// then the fragment template + $df swap once the async resolved).
const SHELL =
  `<template id="pl-1"></template><p _hk=10>loading</p><!--pl-1-->` +
  `<script>(self.$R=self.$R||{})[""]=[];` +
  `_$HY.r["0"]=$R[0]=($R[1]=${DEFERRED}()).p;` +
  `_$HY.r["1_fr"]=$R[3]=($R[4]=$R[2]()).p;</script>`;

const LATE_TEMPLATE = `<template id="1">Count: <!--!$-->42<!--!$--> <span _hk=1001>after</span></template>`;

const LATE_SCRIPT =
  `<script>${RESOLVER_FN}($R[1],42);$df("1");` +
  `function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}` +
  `;$R[5]($R[4],!0);</script>`;

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

describe("insert `current` tracking across hydration (#2801 bug 1)", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;
  let refresh!: () => void;

  function Comp() {
    const [version, setVersion] = createSignal(0);
    refresh = () => setVersion(v => v + 1);
    const data = createMemo(async () => {
      const v = version();
      await sleep(5);
      return 42 + v;
    });
    return (
      <Loading fallback={<p>loading</p>}>
        Count: {data()} <span>after</span>
      </Loading>
    );
  }

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

  async function assertRefreshesReplaceInPlace() {
    const serverSpan = container.querySelector("span")!;
    expect(container.textContent).toBe("Count: 42 after");

    for (let i = 1; i <= 3; i++) {
      refresh();
      flush();
      await sleep(30);
      flush();
      await sleep(30);
      // drifted `current` appended instead: "Count: 42 after43"
      expect(container.textContent).toBe(`Count: ${42 + i} after`);
      expect(container.querySelectorAll("span").length).toBe(1);
      expect(container.querySelector("span")).toBe(serverSpan);
    }
  }

  test("refresh after single-chunk hydration replaces the value in place", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyChunk(container, SINGLE_CHUNK, true);

    dispose = hydrate(() => <Comp />, container);
    await sleep(50);
    flush();
    await sleep(50);

    await assertRefreshesReplaceInPlace();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("refresh after late-streamed fragment hydration replaces the value in place", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyChunk(container, SHELL, true);

    dispose = hydrate(() => <Comp />, container);
    await Promise.resolve();
    flush();
    expect(container.textContent).toBe("loading");

    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    await sleep(50);
    flush();
    await sleep(50);

    await assertRefreshesReplaceInPlace();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
