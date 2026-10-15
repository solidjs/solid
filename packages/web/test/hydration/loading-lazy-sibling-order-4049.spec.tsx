/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4049: a settled <Loading> whose lazy() module is still loading when
 * hydration starts claims its server nodes once the module lands (#3749).
 * With a sibling of the boundary in the same fragment (one insert), the
 * root pass tracks only the sibling, and the late claim reconciled against
 * it: a sibling BEFORE the boundary reversed the static and lazy children
 * (A/C/B instead of A/B/C), and a sibling AFTER it detached and re-attached
 * the boundary's content (restarting animations, blurring focus). The HTML
 * below is renderToStream's output for each tree (module resolved during the
 * render, a manifest answering "/assets/part.js").
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, flush, lazy, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("#4049: Loading around lazy() beside a sibling keeps server order", () => {
  let dispose: (() => void) | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    await sleep(0);
    container?.remove();
  });

  async function hydrateWithLateModule(
    html: string,
    boundaryId: string,
    moduleId: string,
    Part: () => any,
    app: (Lazy: any) => any,
    focus?: string
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    const host = container;
    const server = [...host.childNodes];
    const focused = focus ? (container.querySelector(focus) as HTMLInputElement) : undefined;

    // The lazy module is still in flight when hydration starts.
    let land!: () => void;
    const fr: any = Promise.resolve(true);
    fr.s = 1;
    fr.v = true;
    const hy: any = {
      events: [],
      completed: new WeakSet(),
      r: { [boundaryId + "_assets"]: { [moduleId]: "/assets/part.js" }, [boundaryId + "_fr"]: fr },
      fe() {},
      modules: {},
      loading: {}
    };
    hy.loading[moduleId] = new Promise<void>(r => (land = r)).then(() => {
      hy.modules[moduleId] = { default: Part };
    });
    (globalThis as any)._$HY = hy;

    focused?.focus();
    const Lazy = lazy(() => Promise.resolve({ default: Part }), undefined, "src/Part.tsx");
    const moved: Node[] = [];
    const observer = new MutationObserver(records => {
      for (const r of records) moved.push(...r.addedNodes, ...r.removedNodes);
    });
    observer.observe(container, { childList: true, subtree: true });

    dispose = hydrate(() => app(Lazy), container);
    flush();
    await sleep(10);
    land();
    await sleep(10);
    flush();
    await sleep(10);
    observer.disconnect();

    expect(host.childNodes.length).toBe(server.length);
    for (let i = 0; i < server.length; i++) expect(host.childNodes[i]).toBe(server[i]);
    expect(moved).toEqual([]);
    if (focused) expect(document.activeElement).toBe(focused);
    return host;
  }

  test("a sibling before the boundary keeps static and lazy children in order", async () => {
    let setCount!: (v: number) => void;
    function Part() {
      const [count, set] = createSignal(0);
      setCount = set;
      return <span>C{count()}</span>;
    }
    const host = await hydrateWithLateModule(
      "<span _hk=0>A</span><span _hk=1000>B</span><span _hk=10010>C<!--$-->0<!--/--></span>",
      "1",
      "1001",
      Part,
      Lazy => (
        <>
          <span>A</span>
          <Loading fallback="pending">
            <span>B</span>
            <Lazy />
          </Loading>
        </>
      )
    );
    expect(host.textContent).toBe("ABC0");
    // Hydrated: the lazy part's text hole is live.
    setCount(1);
    flush();
    expect(host.textContent).toBe("ABC1");
  });

  test("a sibling after the boundary leaves the claimed content attached", async () => {
    let setCount!: (v: number) => void;
    function Page() {
      const [count, set] = createSignal(0);
      setCount = set;
      return (
        <main>
          <input aria-label="Type" />
          {count()}
        </main>
      );
    }
    const host = await hydrateWithLateModule(
      '<main _hk=00000><input aria-label="Type"><!--$-->0<!--/--></main><footer _hk=1>F</footer>',
      "0",
      "0000",
      Page,
      Lazy => (
        <>
          <Loading fallback="pending">
            <Lazy />
          </Loading>
          <footer>F</footer>
        </>
      ),
      "input"
    );
    expect(host.textContent).toBe("0F");
    setCount(1);
    flush();
    expect(host.textContent).toBe("1F");
  });
});
