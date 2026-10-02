/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3749: a settled <Loading> whose lazy() module is still loading when
 * hydration starts renders nothing in the root pass and claims its server
 * nodes once the module lands. The insert holding the boundary's value sits
 * outside the boundary, so it lands them as a client insert — and must not
 * re-insert nodes that are already in place: moving a connected node blurs a
 * focused input the user is typing in.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, flush, lazy, Loading, type Component } from "solid-js";
import { hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let setCount!: (v: number) => void;
function FragmentPage() {
  const [count, set] = createSignal(0);
  setCount = set;
  return (
    <>
      <header>Header</header>
      <main>
        <input aria-label="Type" />
        <button>Count: {count()}</button>
      </main>
    </>
  );
}
function ElementPage() {
  const [count, set] = createSignal(0);
  setCount = set;
  return (
    <main>
      <input aria-label="Type" />
      <button>Count: {count()}</button>
    </main>
  );
}

// renderToStream output for each tree below (the module resolved during the
// render, a manifest answering "/assets/Page.js"): the boundary's fragment is
// settled and its content inlined, with its module map under `1_assets`.
const FRAGMENT_HTML =
  '<div _hk=0><header _hk=10000>Header</header><main _hk=10001><input aria-label="Type"><button>Count: <!--$-->0<!--/--></button></main></div>';
const ELEMENT_HTML =
  '<div _hk=0><main _hk=10000><input aria-label="Type"><button>Count: <!--$-->0<!--/--></button></main></div>';

describe("#3749: Loading around lazy() keeps server nodes in place on a late module", () => {
  let dispose: (() => void) | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    await sleep(0);
    container?.remove();
  });

  async function hydrateWithLateModule(Page: Component, html: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    const server = [...container.firstChild!.childNodes];
    const input = container.querySelector("input")!;

    // The page module is still in flight when hydration starts.
    let land!: () => void;
    const fr: any = Promise.resolve(true);
    fr.s = 1;
    fr.v = true;
    const hy: any = {
      events: [],
      completed: new WeakSet(),
      r: { "1_assets": { "1000": "/assets/Page.js" }, "1_fr": fr },
      fe() {},
      modules: {},
      loading: {}
    };
    hy.loading["1000"] = new Promise<void>(r => (land = r)).then(() => {
      hy.modules["1000"] = { default: Page };
    });
    (globalThis as any)._$HY = hy;

    // The user is typing before hydration.
    input.focus();
    input.value = "typed";

    const LazyPage = lazy(() => Promise.resolve({ default: Page }), undefined, "src/Page.tsx");
    const moved: Node[] = [];
    const observer = new MutationObserver(records => {
      for (const r of records) moved.push(...r.addedNodes, ...r.removedNodes);
    });
    observer.observe(container, { childList: true, subtree: true });

    dispose = hydrate(
      () => (
        <div>
          <Loading fallback="Loading...">
            <LazyPage />
          </Loading>
        </div>
      ),
      container
    );
    flush();
    await sleep(10);
    land();
    await sleep(10);
    flush();
    await sleep(10);
    observer.disconnect();

    expect([...container.firstChild!.childNodes]).toEqual(server);
    for (let i = 0; i < server.length; i++)
      expect(container.firstChild!.childNodes[i]).toBe(server[i]);
    expect(moved).toEqual([]);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("typed");
  }

  test("a fragment page claims in place and keeps focus", async () => {
    await hydrateWithLateModule(FragmentPage, FRAGMENT_HTML);
    // Hydrated: the button's text hole is live.
    setCount(1);
    flush();
    expect(container!.textContent).toBe("HeaderCount: 1");
  });

  test("a single-element page claims in place and keeps focus", async () => {
    await hydrateWithLateModule(ElementPage, ELEMENT_HTML);
    setCount(1);
    flush();
    expect(container!.textContent).toBe("Count: 1");
  });
});
