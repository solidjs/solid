/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { sharedConfig, createMemo, createSignal, flush, Errored, Loading } from "solid-js";
import { hydrate, insert } from "@solidjs/web";
import type * as WebServer from "../../types/server.js";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

async function renderStreamHtml(code: () => any): Promise<string> {
  const serverEntry = new URL("./dist/server.js", `file://${process.cwd()}/`).href;
  const { renderToStream } = (await import(/* @vite-ignore */ serverEntry)) as typeof WebServer;
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(String(chunk));
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

function mountStreamHtml(container: HTMLDivElement, html: string) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...html.matchAll(scriptRe)].map(match => match[1]);
  container.innerHTML = html.replace(scriptRe, "");
  for (const script of scripts) (0, eval)(script);
}

async function settleHydration() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await new Promise(r => setTimeout(r, 50));
}

function expectNoOrphanWarnings(warn: ReturnType<typeof vi.spyOn>) {
  const orphanWarns = warn.mock.calls.filter(
    (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
  );
  expect(orphanWarns).toHaveLength(0);
}

describe("Phase 1: Hydration error diagnostics", () => {
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

  test("warns on tag mismatch between claimed node and JSX template", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<span _hk="0">Wrong tag</span>';

    dispose = hydrate(() => <div>Expected div</div>, container);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("expected <div> but found"),
      expect.any(Object)
    );
    warn.mockRestore();
  });

  test("no tag mismatch warning when tags match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<div _hk="0">Content</div>';

    dispose = hydrate(() => <div>Content</div>, container);

    const tagWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("tag mismatch")
    );
    expect(tagWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("orphan detection fires automatically via drainHydrationCallbacks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<div _hk="0">Claimed</div><span _hk="1">Orphan</span>';

    dispose = hydrate(() => <div>Claimed</div>, container);

    // verifyHydration fires inside setTimeout in drainHydrationCallbacks
    await new Promise(r => setTimeout(r, 50));

    const orphanWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns.length).toBeGreaterThanOrEqual(1);
    expect(orphanWarns[0][0]).toContain("<span");
    warn.mockRestore();
  });

  test("late Loading rejection hydrates without orphan warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected: Promise<{ title: string }> = Promise.reject(
      new Error("Item bad-item not found")
    );
    rejected.catch(() => {});
    const html = await renderStreamHtml(() => {
      const item = createMemo(() => rejected);
      return (
        <Errored fallback={(e: any) => `ItemError: ${String(e().message || e())}`}>
          <Loading fallback={"Item Loading..."}>{item().title as any}</Loading>
        </Errored>
      );
    });

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(() => {
      const item = createMemo(() => rejected);
      return (
        <Errored fallback={(e: any) => `ItemError: ${String(e().message || e())}`}>
          <Loading fallback={"Item Loading..."}>{item().title as any}</Loading>
        </Errored>
      );
    }, container);

    await settleHydration();

    expect(container.textContent).toBe("ItemError: Item bad-item not found");
    expect(container.innerHTML).not.toContain('id="pl-0"');

    expectNoOrphanWarnings(warn);
    warn.mockRestore();
  });

  test("Errored wrapping Loading hydrates resolved async siblings once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Test(props: { id: string }) {
      const data = createMemo(async () => {
        await Promise.resolve();
        return props.id;
      });

      return (
        <Errored fallback={"Error loading test query..."}>
          <Loading fallback={"Loading test query..."}>
            <div class="test-block">Test query result: {data()}</div>
          </Loading>
        </Errored>
      );
    }

    function App() {
      return (
        <div>
          <h2>createQueryTest</h2>
          <Test id="key-1" />
          <p>Another query</p>
          <Test id="key-2" />
        </div>
      );
    }

    const html =
      '<div _hk=0><h2>createQueryTest</h2><!--$--><div _hk=200000 class="test-block">Test query result: <!--$-->key-1<!--/--></div><!--/--><p>Another query</p><!--$--><div _hk=500000 class="test-block">Test query result: <!--$-->key-2<!--/--></div><!--/--></div><script>(self.$R=self.$R||{})[""]=[];_$HY.r["1"]=$R[0]=($R[1]=($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })()).p;_$HY.r["4"]=$R[3]=($R[4]=$R[2]()).p;_$HY.r["200_fr"]=$R[5]=($R[6]=$R[2]()).p;_$HY.r["500_fr"]=$R[7]=($R[8]=$R[2]()).p;($R[9]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })($R[1],"key-1");$R[9]($R[6],!0);$R[9]($R[4],"key-2");$R[9]($R[8],!0);</script>';

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(() => <App />, container);

    await settleHydration();

    expect([...container.querySelectorAll(".test-block")].map(el => el.textContent)).toEqual([
      "Test query result: key-1",
      "Test query result: key-2"
    ]);

    expectNoOrphanWarnings(warn);
    warn.mockRestore();
  });

  test("Loading wrapping Errored hydrates rejected sibling and reset button once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Item(props: { id: string }) {
      const [id, setId] = createSignal(props.id);
      const item = createMemo(async () => {
        await Promise.resolve();
        if (id() !== "1") throw new Error(`Item ${id()} not found`);
        return { title: "Test Item" };
      });

      return (
        <Loading fallback={<div>Item Loading...</div>}>
          <Errored
            fallback={(error, reset) => (
              <div>
                <div>ItemError: {String(error())}</div>
                <button
                  onClick={() => {
                    setId("1");
                    reset();
                  }}
                >
                  Reset to valid item
                </button>
              </div>
            )}
          >
            <div>{item().title}</div>
          </Errored>
        </Loading>
      );
    }

    function App() {
      return (
        <div>
          <Item id="1" />
          <Item id="bad-item" />
        </div>
      );
    }

    const html =
      '<div _hk=0><!--$--><div _hk=200000>Test Item</div><!--/--><!--$--><div _hk=40010><div>ItemError: <!--$-->Error: Item bad-item not found<!--/--></div><button>Reset to valid item</button></div><!--/--></div><script>(self.$R=self.$R||{})[""]=[];_$HY.r["1"]=$R[0]=($R[1]=($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })()).p;_$HY.r["2_fr"]=$R[3]=($R[4]=$R[2]()).p;_$HY.r["3"]=$R[5]=($R[6]=$R[2]()).p;_$HY.r["4_fr"]=$R[7]=($R[8]=$R[2]()).p;($R[10]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })($R[1],$R[9]={title:"Test Item"});$R[10]($R[4],!0);($R[12]=(resolver, data) => { resolver.f(data); resolver.p.catch(() => {}); resolver.p.s = 2; resolver.p.v = data; })($R[6],$R[11]=new Error("Item bad-item not found"));_$HY.r["4000"]=$R[11];$R[10]($R[8],!0);</script>';

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(() => <App />, container);

    await settleHydration();

    expect([...container.querySelectorAll("button")].map(el => el.textContent)).toEqual([
      "Reset to valid item"
    ]);

    expectNoOrphanWarnings(warn);
    warn.mockRestore();
  });

  test("Errored wrapping Loading hydrates rejected fragment into fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Item(props: { id: string }) {
      const [id, setId] = createSignal(props.id);
      const item = createMemo(async () => {
        await Promise.resolve();
        if (id() !== "1") throw new Error(`Item ${id()} not found`);
        return { title: "Test Item" };
      });

      return (
        <Errored
          fallback={(error, reset) => (
            <div>
              <div>ItemError: {String(error())}</div>
              <button
                onClick={() => {
                  setId("1");
                  reset();
                }}
              >
                Reset to valid item
              </button>
            </div>
          )}
        >
          <Loading fallback={<div>Item Loading...</div>}>
            <div>{item().title}</div>
          </Loading>
        </Errored>
      );
    }

    function App() {
      return (
        <div>
          <Item id="1" />
          <Item id="bad-item" />
        </div>
      );
    }

    const html =
      '<div _hk=0><!--$--><template id="pl-200"></template><div _hk=2000>Item Loading...</div><!--pl-200--><!--/--><!--$--><template id="pl-500"></template><div _hk=5000>Item Loading...</div><!--pl-500--><!--/--></div><template id="200"><div _hk=200000>Test Item</div></template><template id="500"> </template><script>(self.$R=self.$R||{})[""]=[];_$HY.r["1"]=$R[0]=($R[1]=($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })()).p;_$HY.r["200_fr"]=$R[3]=($R[4]=$R[2]()).p;_$HY.r["4"]=$R[5]=($R[6]=$R[2]()).p;_$HY.r["500_fr"]=$R[7]=($R[8]=$R[2]()).p;($R[10]=(resolver, data) => { resolver.s(data); resolver.p.s = 1; resolver.p.v = data; })($R[1],$R[9]={title:"Test Item"});$R[10]($R[4],!0);($R[12]=(resolver, data) => { resolver.f(data); resolver.p.catch(() => {}); resolver.p.s = 2; resolver.p.v = data; })($R[6],$R[11]=new Error("Item bad-item not found"));$R[12]($R[8],$R[11]);function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}$df("200");$df("500");</script>';

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(() => <App />, container);

    await settleHydration();

    expect([...container.querySelectorAll("button")].map(el => el.textContent)).toEqual([
      "Reset to valid item"
    ]);
    expect(container.textContent).toContain("ItemError: Error: Item bad-item not found");

    expectNoOrphanWarnings(warn);
    warn.mockRestore();
  });

  test("Errored wrapping Loading hydrates late rejected fragment into fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Item() {
      const item = createMemo(async (): Promise<{ title: string }> => {
        await Promise.resolve();
        throw new Error("Item bad-item not found");
      });

      return (
        <Errored
          fallback={error => (
            <div>
              <div>ItemError: {String(error())}</div>
              <button>Reset to valid item</button>
            </div>
          )}
        >
          <Loading fallback={<div>Item Loading...</div>}>
            <div>{item().title}</div>
          </Loading>
        </Errored>
      );
    }

    const html =
      '<div _hk=0><!--$--><template id="pl-200"></template><div _hk=2000>Item Loading...</div><!--pl-200--><!--/--></div><template id="200"> </template><script>(self.$R=self.$R||{})[""]=[];_$HY.r["1"]=$R[0]=($R[1]=($R[2]=() => { const resolver = { p: 0, s: 0, f: 0 }; resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; }); return resolver; })()).p;_$HY.r["200_fr"]=$R[3]=($R[4]=$R[2]()).p;function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}</script>';

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(
      () => (
        <div>
          <Item />
        </div>
      ),
      container
    );

    (0, eval)(
      '($R[6]=(resolver, data) => { resolver.f(data); resolver.p.catch(() => {}); resolver.p.s = 2; resolver.p.v = data; })($R[1],$R[5]=new Error("Item bad-item not found"));$df("200");$R[6]($R[4],$R[5]);'
    );

    await settleHydration();

    expect([...container.querySelectorAll("button")].map(el => el.textContent)).toEqual([
      "Reset to valid item"
    ]);
    expect(container.textContent).toContain("ItemError: Error: Item bad-item not found");

    expectNoOrphanWarnings(warn);
    warn.mockRestore();
  });
});

describe("Phase 2: Walk validation", () => {
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

  test("getFirstChild warns on browser-corrected structure (tbody insertion)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("Cell");

    container.innerHTML = '<table _hk="0"><tbody><tr><td>Cell</td></tr></tbody></table>';

    dispose = hydrate(
      () => (
        <table>
          <tr>
            <td>{text()}</td>
          </tr>
        </table>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    expect(structureWarns[0][0]).toContain("expected <tr>");
    warn.mockRestore();
  });

  test("getNextSibling warns when sibling has wrong tag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("dynamic");

    container.innerHTML =
      '<div _hk="0"><header>Title</header><div>Wrong tag</div><footer>End</footer></div>';

    dispose = hydrate(
      () => (
        <div>
          <header>Title</header>
          <main>{text()}</main>
          <footer>End</footer>
        </div>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    expect(structureWarns[0][0]).toContain("expected <main>");
    warn.mockRestore();
  });

  test("getFirstChild warns on missing child", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("item");

    container.innerHTML = '<ul _hk="0"></ul>';

    dispose = hydrate(
      () => (
        <ul>
          <li>{text()}</li>
        </ul>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    const viz = structureWarns[0][2] as string;
    expect(viz).toContain("missing");
    warn.mockRestore();
  });

  test("no structure warnings on correct hydration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("dynamic");

    container.innerHTML =
      '<div _hk="0"><header>Title</header><main>dynamic</main><footer>End</footer></div>';

    dispose = hydrate(
      () => (
        <div>
          <header>Title</header>
          <main>{text()}</main>
          <footer>End</footer>
        </div>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("describeSiblings visualization appears in warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("Cell");

    container.innerHTML = '<table _hk="0"><tbody><tr><td>Cell</td></tr></tbody></table>';

    dispose = hydrate(
      () => (
        <table>
          <tr>
            <td>{text()}</td>
          </tr>
        </table>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    const viz = structureWarns[0][2] as string;
    expect(viz).toContain("<table>");
    expect(viz).toContain("</table>");
    expect(viz).toContain("\u2190");
    warn.mockRestore();
  });
});
