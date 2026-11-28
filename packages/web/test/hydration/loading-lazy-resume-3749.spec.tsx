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
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, Errored, flush, isHydrating, lazy, Loading, type Component } from "solid-js";
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

  function renderWithSibling(Page: Component) {
    return (
      <>
        <Loading fallback="Loading...">
          <Page />
        </Loading>
        <footer>Footer</footer>
      </>
    );
  }

  test.each([
    {
      context: "inside an element",
      html: "<div _hk=0><main _hk=10000>Server page</main></div>",
      boundaryId: "1",
      moduleId: "1000",
      render: (Page: Component) => (
        <div>
          <Loading fallback="Loading...">
            <Page />
          </Loading>
        </div>
      )
    },
    {
      context: "beside a sibling in the same insert",
      html: "<main _hk=00000>Server page</main><footer _hk=1>Footer</footer>",
      boundaryId: "0",
      moduleId: "0000",
      render: renderWithSibling
    },
    {
      context: "when the retry fails beside a sibling",
      html: "<main _hk=00000>Server page</main><footer _hk=1>Footer</footer>",
      boundaryId: "0",
      moduleId: "0000",
      render: renderWithSibling,
      retryFails: true
    }
  ])(
    "a failed preload replaces the server page $context",
    async ({ html, boundaryId, moduleId, render, retryFails }) => {
      container = document.createElement("div");
      document.body.appendChild(container);
      container.innerHTML = html;
      const serverPage = container.querySelector("main")!;
      const footer = container.querySelector("footer");
      const fragment = Object.assign(Promise.resolve(true), { s: 1, v: true });
      let rejectPreload!: (error: Error) => void;
      (globalThis as any)._$HY = {
        events: [],
        completed: new WeakSet(),
        r: {
          [boundaryId + "_assets"]: { [moduleId]: "/assets/Page.js" },
          [boundaryId + "_fr"]: fragment
        },
        fe() {},
        modules: {},
        loading: { [moduleId]: new Promise<void>((_, reject) => (rejectPreload = reject)) }
      };
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const lazyLoad = vi.fn(async () => {
        if (retryFails) throw new Error("retry 404");
        return { default: () => <main>Client page</main> };
      });
      const LazyPage = lazy(lazyLoad, undefined, "src/Page.tsx");
      const Page = retryFails
        ? () => (
            <Errored fallback={<p>Client error</p>}>
              <LazyPage />
            </Errored>
          )
        : LazyPage;
      try {
        dispose = hydrate(() => render(Page), container);
        expect(container.querySelector("main")).toBe(serverPage);
        rejectPreload(new Error("chunk 404"));
        await sleep(0);
        flush();
        await sleep(0);
        expect(lazyLoad).toHaveBeenCalledTimes(1);
        expect(container.textContent).toBe(
          (retryFails ? "Client error" : "Client page") + (footer ? "Footer" : "")
        );
        expect(serverPage.isConnected).toBe(false);
        expect(container.querySelector("footer")).toBe(footer);
      } finally {
        error.mockRestore();
      }
    }
  );

  test("after hydration an untracked region re-inserts nodes already in its parent", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<div _hk=0></div>";
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const a = document.createElement("b");
    const b = document.createElement("i");
    const [show, setShow] = createSignal(false);
    dispose = hydrate(() => <div>{show() ? [a, b] : undefined}</div>, container);
    flush();
    await sleep(10);
    expect(isHydrating()).toBe(false);

    // User code put the nodes in the region, ahead of a node it doesn't track.
    const host = container.firstChild as HTMLElement;
    const x = document.createElement("span");
    host.append(a, b, x);
    setShow(true);
    flush();
    // As on `next`: the run is re-inserted at the end.
    expect([...host.childNodes]).toEqual([x, a, b]);
  });
});
