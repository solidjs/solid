/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression (#2801 bug 2): `{data().value && <h4>...</h4>}` before a <For>,
 * where the condition reads an async memo inside a streamed <Loading>.
 *
 * Hydration keys are owner-path child-id slots. The server's lean sync memo
 * re-runs its compute on every pull after a `NotReadyError`, and previously
 * did so without resetting the owner's child state — each failed pull leaked
 * the child-id slots it consumed (the compiler-emitted inner memo of the `&&`
 * expression), so the keys produced by the eventual successful pull drifted
 * ahead of the client's single successful compute. The server wrote
 * `<h4 _hk=10003>`; the client claimed `10001`; the h4 went unclaimed
 * (duplicated in prod, dev warns "unclaimed server-rendered node").
 */
import { describe, expect, test, vi } from "vitest";
import { createMemo, createSignal, flush, Loading, enableHydration } from "solid-js";
import { For, hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Exact renderToStream chunks for the async component below (server build).
const SHELL_HTML = `<template id="pl-1"></template><div _hk=10>loading</div><!--pl-1-->`;
const SHELL_SCRIPT = `(self.$R=self.$R||{})[""]=[];_$HY.r["0"]=$R[0]=($R[1]=($R[2]=() => {
  const resolver = {
    p: 0,
    s: 0,
    f: 0
  };
  resolver.p = new Promise((resolve, reject) => {
    resolver.s = resolve;
    resolver.f = reject;
  });
  return resolver;
})()).p;_$HY.r["1_fr"]=$R[3]=($R[4]=$R[2]()).p;`;

const LATE_TEMPLATE = `<template id="1"><h4 _hk=10001>shown</h4><!--!$--><div _hk=100100>a</div><div _hk=100110>b</div></template>`;

const LATE_SCRIPT = `($R[6]=(resolver, data) => {
  resolver.s(data);
  resolver.p.s = 1;
  resolver.p.v = data;
})($R[1],$R[5]={value:"shown"});$df("1");function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1};$R[6]($R[4],!0);`;

describe("#2801: && expression before <For> across hydration", () => {
  test("async condition — streamed fragment is fully claimed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    setupHydration();
    container.innerHTML = SHELL_HTML;
    (0, eval)(SHELL_SCRIPT);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispose = hydrate(() => {
      const data = createMemo(async () => {
        await sleep(5);
        return { value: "shown" };
      });
      const [items] = createSignal(["a", "b"]);
      return (
        <Loading fallback={<div>loading</div>}>
          {data().value && <h4>{data().value}</h4>}
          <For each={items()}>{x => <div>{x}</div>}</For>
        </Loading>
      );
    }, container);

    flush();
    await sleep(10);
    // stream the late fragment + resolver script
    container.insertAdjacentHTML("beforeend", LATE_TEMPLATE);
    (0, eval)(LATE_SCRIPT);
    await sleep(30);
    flush();
    await sleep(30);

    const messages = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    const problems = messages.filter(m => /unclaimed|mismatch|hydration/i.test(m));

    expect(container.querySelectorAll("h4").length).toBe(1);
    expect(container.querySelectorAll("div:not([id])").length).toBe(2);
    expect(container.textContent).toBe("shownab");
    expect(problems).toEqual([]);

    dispose();
    warn.mockRestore();
    error.mockRestore();
  });

  test("sync condition — server nodes are claimed in place", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    setupHydration();
    // Exact renderToStream output for the sync component below (server build)
    container.innerHTML =
      `<div _hk=0><!--$--><h4 _hk=2>shown</h4><!--/--><!--$-->` +
      `<div _hk=300>a</div><div _hk=310>b</div><!--/--></div>`;

    const serverH4 = container.querySelector("h4")!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispose = hydrate(() => {
      const [show] = createSignal(true);
      const [items] = createSignal(["a", "b"]);
      return (
        <div>
          {show() && <h4>shown</h4>}
          <For each={items()}>{x => <div>{x}</div>}</For>
        </div>
      );
    }, container);

    flush();
    await sleep(50);

    const messages = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    const problems = messages.filter(m => /unclaimed|mismatch|hydration/i.test(m));

    expect(container.querySelectorAll("h4").length).toBe(1);
    const appDiv = container.firstElementChild!;
    expect(appDiv.querySelectorAll("div").length).toBe(2);
    expect(container.textContent).toBe("shownab");
    // the server-rendered h4 must be claimed, not replaced
    expect(container.querySelector("h4")).toBe(serverH4);
    expect(problems).toEqual([]);

    dispose();
    warn.mockRestore();
    error.mockRestore();
  });
});
