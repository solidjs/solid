/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3610: `hydrate()` can run before the document's records `<script>` has.
 *
 * A hand-built document (`generateHydrationScript()` in the host's <head>,
 * the render output — with its records script appended — in the body) lets
 * a still-loading stylesheet block the classic records script while an
 * `async` module entry runs on arrival. `hydrate()` then sees the bootstrap's
 * empty `_$HY.r`: a streamed <Loading> finds neither its record nor its
 * `_fr` declaration and falls through to the core boundary — a `Hydration
 * key miss` on the fallback, a real client refetch, and a `$df` swap nobody
 * claims.
 *
 * The readiness gate: a bootstrap emitted by `generateHydrationScript()`
 * carries `p:1` (records are placed independently of it and may still be
 * pending in the parser). While that flag is set, the parser is still
 * running, and no record has landed, `hydrate()` parks its start on the
 * first `_$HY.r` write (the records script executing) or `DOMContentLoaded`
 * (the parser finishing — nothing parser-inserted can run after it). The
 * dispose function is still returned synchronously and cancels a parked
 * start. `<HydrationScript />` (a JSX document) omits the flag: there the
 * records are spliced immediately after the bootstrap, so the two can never
 * be separated.
 *
 * Fixture (SHELL/MID/LATE) is the chained-async-memo stream from
 * loading-late-fragment.spec.tsx, which passes on `next` when the records run
 * before `hydrate()`.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, flush, Loading, sharedConfig } from "solid-js";
import { For, hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// What `generateHydrationScript()` (hand-built documents) bootstraps: the
// records may be parser-pending, so `p:1`.
function bootstrapOutOfBand() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {}, p: 1 };
}
// What `<HydrationScript />` (JSX documents) bootstraps: no `p` — the
// records script, if any, is spliced right after this one.
function bootstrapInRender() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

// jsdom reports "complete" for a test document; the race only exists while
// the parser is still running.
function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, "readyState", { configurable: true, get: () => state });
}
function restoreReadyState() {
  delete (document as any).readyState;
}
function parserFinished() {
  setReadyState("interactive");
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

let realFetchCalls = 0;
(globalThis as any).fetch = async () => {
  realFetchCalls++;
  return { ok: true };
};
const fetchItems = async (id: number) => {
  await fetch("/items/" + id);
  return ["item " + id];
};

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

// A streaming parse in two halves: the markup lands (the parser inserts it
// and the <script> element), the script's execution is a separate step —
// the one a pending stylesheet delays.
function splitChunk(chunk: string) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  return {
    html: chunk.replace(scriptRe, ""),
    scripts: [...chunk.matchAll(scriptRe)].map(m => m[1])
  };
}
function applyHtml(container: HTMLElement, html: string, first: boolean) {
  if (first) container.innerHTML = html;
  else container.insertAdjacentHTML("beforeend", html);
}
function runScripts(scripts: string[]) {
  for (const s of scripts) (0, eval)(s);
}

async function settle() {
  await sleep(50);
  flush();
  await sleep(50);
  flush();
}

describe("hydrate() waits for the records the document declared (#3610)", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;
  let homeCalls = 0;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    if (dispose) dispose();
    await sleep(0);
    container.innerHTML = "";
    realFetchCalls = 0;
    homeCalls = 0;
    delete (self as any).$R;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    restoreReadyState();
    warn.mockRestore();
  });

  function Home() {
    homeCalls++;
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

  function expectNoWarnings() {
    expect(warn.mock.calls.map((c: unknown[]) => c.join(" "))).toEqual([]);
  }

  // Everything after the records: the stream's remaining chunks in parse
  // order, then the assertions shared by the racing case and its control.
  async function streamRestAndAssert() {
    const mid = splitChunk(MID);
    applyHtml(container, mid.html, false);
    runScripts(mid.scripts);
    await Promise.resolve();
    flush();
    applyHtml(container, LATE_TEMPLATE, false);
    const serverItem = container.querySelector<HTMLTemplateElement>('template[id="3"]')!.content
      .firstChild as HTMLElement;
    expect(serverItem.textContent).toBe("item 1");
    runScripts(splitChunk(LATE_SCRIPT).scripts);
    await settle();

    // One copy of the content — the server's node, adopted through the
    // fragment swap — and no client work to produce it.
    expect(container.querySelectorAll("div")).toHaveLength(1);
    expect(container.querySelector("div")).toBe(serverItem);
    expect(container.textContent).toBe("item 1");
    expect(container.querySelector("template")).toBeNull();
    expect(realFetchCalls).toBe(0);
    expectNoWarnings();
  }

  test("records script stalled behind hydrate(): the start parks until it runs", async () => {
    bootstrapOutOfBand();
    setReadyState("loading");
    const hy = (globalThis as any)._$HY;
    const records = hy.r;

    const shell = splitChunk(SHELL);
    applyHtml(container, shell.html, true);
    expect(Object.keys(hy.r)).toEqual([]);

    dispose = hydrate(() => <Home />, container);
    expect(typeof dispose).toBe("function");
    await Promise.resolve();
    flush();
    // Parked: nothing rendered, nothing claimed, no warning about the
    // fallback's key, no client fetch.
    expect(homeCalls).toBe(0);
    expect(sharedConfig.hydrating).toBeFalsy();
    expect(realFetchCalls).toBe(0);
    expectNoWarnings();

    // The stylesheet lands; the blocked records script runs.
    runScripts(shell.scripts);
    expect(Object.keys(hy.r).sort()).toEqual(["0", "3_fr"]);
    // The interceptor is gone once it has done its job: later chunks write
    // into the bootstrap's own object.
    expect(hy.r).toBe(records);
    // The start rides a microtask after the script that wrote the records,
    // so the whole script's writes are visible to the claim walk.
    expect(homeCalls).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(homeCalls).toBe(1);

    await streamRestAndAssert();
  });

  test("control: records already installed — hydrate() starts synchronously", async () => {
    bootstrapOutOfBand();
    setReadyState("loading");
    const shell = splitChunk(SHELL);
    applyHtml(container, shell.html, true);
    runScripts(shell.scripts);

    dispose = hydrate(() => <Home />, container);
    expect(homeCalls).toBe(1);
    await Promise.resolve();
    flush();

    await streamRestAndAssert();
  });

  test("no records, JSX document (<HydrationScript />): synchronous as before", async () => {
    // The in-render bootstrap carries no `p`: even mid-parse with an empty
    // `_$HY.r`, hydrate() never waits.
    bootstrapInRender();
    setReadyState("loading");
    container.innerHTML = `<button _hk=0>count: <!--$-->0<!--/--></button>`;
    const serverButton = container.querySelector("button")!;

    let started = 0;
    dispose = hydrate(() => {
      started++;
      return <button>count: {0}</button>;
    }, container);
    expect(started).toBe(1);
    flush();
    await sleep(10);
    flush();
    expect(container.querySelector("button")).toBe(serverButton);
    expectNoWarnings();
  });

  test("no records, hand-built document, parser finished: synchronous as before", async () => {
    // `generateHydrationScript()`'s `p:1` with the parser done (a module or
    // deferred entry; every existing test): nothing can still be pending.
    bootstrapOutOfBand();
    expect(document.readyState).toBe("complete");
    container.innerHTML = `<button _hk=0>count: <!--$-->0<!--/--></button>`;
    const serverButton = container.querySelector("button")!;

    let started = 0;
    dispose = hydrate(() => {
      started++;
      return <button>count: {0}</button>;
    }, container);
    expect(started).toBe(1);
    flush();
    await sleep(10);
    flush();
    expect(container.querySelector("button")).toBe(serverButton);
    expectNoWarnings();
  });

  test("no records, hand-built document, mid-parse: the parser finishing is the release", async () => {
    // With `p:1` the bootstrap cannot say whether a records script follows;
    // DOMContentLoaded is the proof that none does (nothing parser-inserted
    // runs after it), and the start is released there.
    bootstrapOutOfBand();
    setReadyState("loading");
    const hy = (globalThis as any)._$HY;
    const records = hy.r;
    container.innerHTML = `<button _hk=0>count: <!--$-->0<!--/--></button>`;
    const serverButton = container.querySelector("button")!;

    let started = 0;
    dispose = hydrate(() => {
      started++;
      return <button>count: {0}</button>;
    }, container);
    expect(started).toBe(0);
    await sleep(0);
    expect(started).toBe(0);

    parserFinished();
    expect(started).toBe(1);
    expect(hy.r).toBe(records);
    flush();
    await sleep(10);
    flush();
    expect(container.querySelector("button")).toBe(serverButton);
    expectNoWarnings();
  });

  test("dispose before the records arrive cancels the parked start", async () => {
    bootstrapOutOfBand();
    setReadyState("loading");
    const hy = (globalThis as any)._$HY;
    const records = hy.r;

    const shell = splitChunk(SHELL);
    applyHtml(container, shell.html, true);
    const disposeNow = hydrate(() => <Home />, container);
    expect(homeCalls).toBe(0);
    disposeNow();
    // The interceptor is withdrawn with the cancellation.
    expect(hy.r).toBe(records);

    // The records and the rest of the stream still arrive — the server's
    // scripts run regardless — and none of it starts hydration.
    runScripts(shell.scripts);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(homeCalls).toBe(0);
    expect(sharedConfig.hydrating).toBeFalsy();
    const mid = splitChunk(MID);
    applyHtml(container, mid.html, false);
    runScripts(mid.scripts);
    applyHtml(container, LATE_TEMPLATE, false);
    runScripts(splitChunk(LATE_SCRIPT).scripts);
    parserFinished();
    await settle();
    expect(homeCalls).toBe(0);
    expect(realFetchCalls).toBe(0);
    // Idempotent, like the dispose of a started root.
    disposeNow();
    expectNoWarnings();
    // The `_fr` promise the shell declared is left to the server's late
    // script, which settled it; nothing here consumed it.
    await (hy.r["3_fr"] as Promise<unknown>);
  });
});
