/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression (#2919): with whole-document streamed SSR, a <Loading> boundary
 * duplicated resolved content after a Solid Refresh HMR update instead of
 * replacing it ("Hello World2Hello World2333"). Repro conditions: hydration
 * begins against the streamed fallback (cached async client entry), the $df
 * reveal swaps the settled content in, hydration completes, and then the
 * component OWNING the boundary is hot-swapped through the refresh runtime's
 * patchComponent path (text-only edits change the signature, so the proxy's
 * transparent memo re-renders the whole component subtree in place).
 *
 * The captured stream chunks and DOM shape mirror insert-refresh-drift.spec.tsx
 * (#2801 bug 1), which covers reactive refresh in the same stream states; this
 * spec covers component replacement via the HMR proxy instead.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createComponent, createMemo, flush, Loading } from "solid-js";
import { $$component, $$refresh, $$registry } from "solid-js/refresh";
import { hydrate } from "../../src/index.js";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DEFERRED =
  "($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })";
const RESOLVER_FN =
  "($R[5]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })";

// Captured from renderToStream of <App/> with the data already resolved
// (single chunk — the cached full-page-reload scenario from the issue).
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

/** Minimal mock of Vite's import.meta.hot surface used by the runtime. */
function createViteHot() {
  const data: Record<string, any> = {};
  const invalidate = vi.fn();
  let acceptCallback: ((mod?: unknown) => void) | undefined;
  return {
    hot: { data, accept: (cb: (mod?: unknown) => void) => (acceptCallback = cb), invalidate },
    invalidate,
    fireAccept(mod?: unknown) {
      acceptCallback!(mod);
    }
  };
}

/** The App component the server rendered: async value + siblings + edit text. */
function makeApp(suffix: string) {
  return function App() {
    const data = createMemo(async () => {
      await sleep(5);
      return 42;
    });
    return (
      <Loading fallback={<p>loading</p>}>
        Count: {data()} <span>after</span>
        {suffix}
      </Loading>
    ) as any;
  };
}

/** Simulates one execution of the compiled App.tsx module body. */
function executeModule(hot: ReturnType<typeof createViteHot>["hot"], suffix: string, sig: string) {
  const registry = $$registry();
  const App = $$component(registry, "App", makeApp(suffix), { signature: sig });
  $$refresh("vite", hot as any, registry);
  return App;
}

describe("Loading boundary content across refresh HMR swaps after streamed hydration (#2919)", () => {
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

  async function assertHmrSwapsReplaceInPlace(vite: ReturnType<typeof createViteHot>) {
    expect(container.textContent).toBe("Count: 42 after");

    for (const suffix of ["111", "222", "333"]) {
      // Text-only edit inside the boundary: the module re-executes with a new
      // signature, then Vite fires the captured accept callback.
      executeModule(vite.hot, suffix, `sig-${suffix}`);
      vite.fireAccept({});
      flush();
      // Fresh component => fresh async memo => fallback, then resolution.
      await sleep(30);
      flush();
      await sleep(30);
      // duplication appended instead: "Count: 42 afterCount: 42 after111"
      expect(container.textContent).toBe(`Count: 42 after${suffix}`);
      expect(container.querySelectorAll("span").length).toBe(1);
    }
    expect(vite.invalidate).not.toHaveBeenCalled();
  }

  test("HMR swap after single-chunk hydration replaces the boundary content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vite = createViteHot();
    applyChunk(container, SINGLE_CHUNK, true);

    const App = executeModule(vite.hot, "", "sig-0");
    dispose = hydrate((() => createComponent(App as any, {})) as any, container);
    await sleep(50);
    flush();
    await sleep(50);

    await assertHmrSwapsReplaceInPlace(vite);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("HMR swap after late-streamed fragment hydration replaces the boundary content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vite = createViteHot();
    applyChunk(container, SHELL, true);

    const App = executeModule(vite.hot, "", "sig-0");
    dispose = hydrate((() => createComponent(App as any, {})) as any, container);
    await Promise.resolve();
    flush();
    expect(container.textContent).toBe("loading");

    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    await sleep(50);
    flush();
    await sleep(50);

    await assertHmrSwapsReplaceInPlace(vite);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("HMR swap racing the streamed reveal leaves no duplicate content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vite = createViteHot();
    applyChunk(container, SHELL, true);

    const App = executeModule(vite.hot, "", "sig-0");
    dispose = hydrate((() => createComponent(App as any, {})) as any, container);
    await Promise.resolve();
    flush();
    expect(container.textContent).toBe("loading");

    // The edit lands while the boundary is still hydrating against the
    // streamed fallback — the reveal has not arrived yet.
    executeModule(vite.hot, "111", "sig-111");
    vite.fireAccept({});
    flush();
    // A second edit before the first one's async work settles.
    await sleep(2);
    executeModule(vite.hot, "222", "sig-222");
    vite.fireAccept({});
    flush();

    // Now the server reveal arrives for the original stream.
    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    await sleep(50);
    flush();
    await sleep(50);
    flush();
    await sleep(50);

    expect(container.textContent).toBe("Count: 42 after222");
    expect(container.querySelectorAll("span").length).toBe(1);
    expect(vite.invalidate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("HMR swap between the $df reveal and the hydration resume leaves no orphaned server DOM", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vite = createViteHot();
    applyChunk(container, SHELL, true);

    const App = executeModule(vite.hot, "", "sig-0");
    dispose = hydrate((() => createComponent(App as any, {})) as any, container);
    await Promise.resolve();
    flush();
    expect(container.textContent).toBe("loading");

    // The reveal swaps the streamed fragment into the DOM synchronously, but
    // the boundary's hydration resume is queued behind the fragment promise's
    // microtask. The HMR accept lands in that window and disposes the old
    // boundary before it ever claims the revealed nodes.
    applyChunk(container, LATE_TEMPLATE, false);
    applyChunk(container, LATE_SCRIPT, false);
    executeModule(vite.hot, "111", "sig-111");
    vite.fireAccept({});
    flush();

    await sleep(50);
    flush();
    await sleep(50);
    flush();
    await sleep(50);

    // duplication left the revealed fragment orphaned:
    // "Count: 42 afterCount: 42 after111"
    expect(container.textContent).toBe("Count: 42 after111");
    expect(container.querySelectorAll("span").length).toBe(1);
    expect(vite.invalidate).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
