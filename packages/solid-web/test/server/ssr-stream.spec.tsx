/**
 * @jsxImportSource solid-js
 */
import { describe, expect, test } from "vitest";
import {
  renderToString,
  renderToStream,
  Loading,
  Reveal,
  Show,
  For,
  Repeat,
  Switch,
  Match,
  Errored
} from "@solidjs/web";
import { createMemo, createSignal, lazy } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

function collectChunks(
  code: () => any,
  options: any = {}
): Promise<{ chunks: string[]; shell: string }> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      ...options,
      onCompleteShell() {
        shellDone = true;
        options.onCompleteShell?.();
      }
    }).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) {
          shell = chunks.join("");
        }
      },
      end() {
        if (!shell) shell = chunks.join("");
        resolve({ chunks, shell });
      }
    });
  });
}

function extractHydrationKeys(html: string): string[] {
  const matches = [...html.matchAll(/_hk=([^\s>]+)/g)];
  return matches.map(m => m[1]);
}

// --- Tests ---

describe("SSR Streaming — No Loading Boundary", () => {
  test("top-level async memo blocks the shell", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("TopLevel", 30));
      return (
        <div>
          <p>{data()}</p>
        </div>
      );
    }

    const { shell } = await collectChunks(() => <App />);
    expect(shell).toContain("TopLevel");
  });

  test("top-level async memo resolves in .then() path", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Resolved", 20));
      return <p>{data()}</p>;
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Resolved");
  });

  test("async memo above Loading boundary blocks shell, inner streams", async () => {
    function App() {
      const outer = createMemo(async () => asyncValue("Outer", 20));
      const inner = createMemo(async () => asyncValue("Inner", 60));
      return (
        <div>
          <h1>{outer()}</h1>
          <Loading fallback={<span>Loading inner...</span>}>
            <p>{inner()}</p>
          </Loading>
        </div>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Outer");
    expect(shell).toContain("Loading inner...");
    expect(full).toContain("Inner");
  });

  test("multiple top-level async memos all block the shell", async () => {
    function App() {
      const a = createMemo(async () => asyncValue("Alpha", 10));
      const b = createMemo(async () => asyncValue("Beta", 30));
      return (
        <div>
          <p>{a()}</p>
          <p>{b()}</p>
        </div>
      );
    }

    const { shell } = await collectChunks(() => <App />);
    expect(shell).toContain("Alpha");
    expect(shell).toContain("Beta");
  });
});

describe("SSR Streaming — Basic Rendering", () => {
  test("sync component renders to HTML", async () => {
    const html = await renderComplete(() => (
      <div>
        <h1>Hello</h1>
        <p>World</p>
      </div>
    ));
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
  });

  test("async memo in Loading boundary", async () => {
    function App() {
      const data = createMemo(async () => {
        return asyncValue("Loaded Data");
      });
      return (
        <div>
          <Loading fallback={<span>Loading...</span>}>
            <p>{data()}</p>
          </Loading>
        </div>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Loaded Data");
  });

  test("async memo — shell contains fallback, final has resolved value", async () => {
    function App() {
      const data = createMemo(async () => {
        return asyncValue("Resolved", 50);
      });
      return (
        <div>
          <Loading fallback={<span>Fallback</span>}>
            <p>{data()}</p>
          </Loading>
        </div>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Fallback");
    expect(full).toContain("Resolved");
    expect(full).toContain("<template");
  });

  test("parallel async boundaries", async () => {
    function App() {
      const fast = createMemo(async () => asyncValue("Fast", 10));
      const slow = createMemo(async () => asyncValue("Slow", 50));
      return (
        <div>
          <Loading fallback={<span>Loading fast...</span>}>
            <p>{fast()}</p>
          </Loading>
          <Loading fallback={<span>Loading slow...</span>}>
            <p>{slow()}</p>
          </Loading>
        </div>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Loading fast...");
    expect(shell).toContain("Loading slow...");
    expect(full).toContain("Fast");
    expect(full).toContain("Slow");
  });

  test("nested Loading boundaries", async () => {
    function App() {
      const outer = createMemo(async () => asyncValue("Outer", 20));
      const inner = createMemo(async () => asyncValue("Inner", 40));
      return (
        <Loading fallback={<span>Outer loading</span>}>
          <div>
            <p>{outer()}</p>
            <Loading fallback={<span>Inner loading</span>}>
              <p>{inner()}</p>
            </Loading>
          </div>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Outer");
    expect(html).toContain("Inner");
  });
});

describe("SSR Streaming — deferStream", () => {
  test("deferStream blocks the shell until resolved", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Deferred", 50), {
        deferStream: true
      });
      return (
        <div>
          <Loading fallback={<span>Fallback</span>}>
            <p>{data()}</p>
          </Loading>
        </div>
      );
    }

    const { shell } = await collectChunks(() => <App />);
    expect(shell).toContain("Deferred");
    expect(shell).not.toContain("Fallback");
  });

  test("mixed deferred and non-deferred", async () => {
    function App() {
      const deferred = createMemo(async () => asyncValue("Deferred", 30), {
        deferStream: true
      });
      const streamed = createMemo(async () => asyncValue("Streamed", 60));
      return (
        <div>
          <Loading fallback={<span>Deferred loading</span>}>
            <p>{deferred()}</p>
          </Loading>
          <Loading fallback={<span>Streamed loading</span>}>
            <p>{streamed()}</p>
          </Loading>
        </div>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Deferred");
    expect(shell).not.toContain("Deferred loading");
    expect(shell).toContain("Streamed loading");
    expect(full).toContain("Streamed");
  });
});

describe("SSR Streaming — Error Handling", () => {
  test("error in async computation caught by Errored boundary", async () => {
    function App() {
      const data = createMemo(async () => {
        await delay(10);
        throw new Error("Boom");
      });
      return (
        <Errored fallback={(err: Error) => <span>Error: {err.message}</span>}>
          <Loading fallback={<span>Loading...</span>}>
            <p>{data()}</p>
          </Loading>
        </Errored>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Error:");
    expect(html).toContain("Boom");
  });

  test("stream completes after error (no hang)", async () => {
    function App() {
      const data = createMemo(async () => {
        await delay(10);
        throw new Error("Fail");
      });
      return (
        <Errored fallback={(err: Error) => <span>Caught</span>}>
          <Loading fallback={<span>Loading</span>}>
            <p>{data()}</p>
          </Loading>
        </Errored>
      );
    }

    const { chunks, shell } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Loading");
    expect(full).toContain("Error");
    expect(full).toContain("Fail");
    expect(full).toContain("$df");
  });
});

describe("SSR Streaming — Flow Controls", () => {
  test("Show with async memo", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Visible", 20));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <Show when={true}>
            <p>{data()}</p>
          </Show>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Visible");
  });

  test("For with async items", async () => {
    function App() {
      const items = createMemo(async () => asyncValue(["A", "B", "C"], 20));
      return (
        <Loading fallback={<span>Loading list...</span>}>
          <ul>
            <For each={items()}>{item => <li>{item()}</li>}</For>
          </ul>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toMatch(/<li[^>]*>A<\/li>/);
    expect(html).toMatch(/<li[^>]*>B<\/li>/);
    expect(html).toMatch(/<li[^>]*>C<\/li>/);
  });

  test("Switch/Match with async memo", async () => {
    function App() {
      const status = createMemo(async () => asyncValue("active", 20));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <Switch fallback={<span>Unknown</span>}>
            <Match when={status() === "active"}>
              <p>Active</p>
            </Match>
            <Match when={status() === "inactive"}>
              <p>Inactive</p>
            </Match>
          </Switch>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Active");
    expect(html).not.toContain("Inactive");
    expect(html).not.toContain("Unknown");
  });
});

describe("SSR Streaming — Multiple Async in One Boundary", () => {
  test("two async memos in one Loading boundary", async () => {
    function App() {
      const name = createMemo(async () => asyncValue("Alice", 10));
      const role = createMemo(async () => asyncValue("Admin", 30));
      return (
        <Loading fallback={<span>Loading profile...</span>}>
          <div>
            <p>{name()}</p>
            <p>{role()}</p>
          </div>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Alice");
    expect(html).toContain("Admin");
  });

  test("two async memos in one Loading — shell shows fallback, stream has both", async () => {
    function App() {
      const a = createMemo(async () => asyncValue("First", 10));
      const b = createMemo(async () => asyncValue("Second", 50));
      return (
        <Loading fallback={<span>Wait...</span>}>
          <p>{a()}</p>
          <p>{b()}</p>
        </Loading>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Wait...");
    expect(full).toContain("First");
    expect(full).toContain("Second");
  });
});

describe("SSR Streaming — Chained Async", () => {
  test("sync memo derived from async memo resolves", async () => {
    function App() {
      const base = createMemo(async () => asyncValue("hello", 20));
      const derived = createMemo(() => (base() as string).toUpperCase());
      return (
        <Loading fallback={<span>Loading...</span>}>
          <p>{derived()}</p>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("HELLO");
  });

  test("sync memo derived from async — streams correctly", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("world", 30));
      const greeting = createMemo(() => `Hello ${data()}`);
      return (
        <Loading fallback={<span>Loading...</span>}>
          <p>{greeting()}</p>
        </Loading>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Loading...");
    expect(full).toContain("Hello world");
  });
});

describe("SSR Streaming — Edge Cases", () => {
  test("fast async resolves before shell flush (0ms)", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Instant", 0));
      return (
        <Loading fallback={<span>Fallback</span>}>
          <p>{data()}</p>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Instant");
  });

  test("async resolving to null renders empty", async () => {
    function App() {
      const data = createMemo(async () => asyncValue(null, 10));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <div>{data()}</div>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toMatch(/<div[\s>]/);
    expect(html).not.toContain("Loading...");
  });

  test("async resolving to undefined renders empty", async () => {
    function App() {
      const data = createMemo(async () => asyncValue(undefined, 10));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <div>{data()}</div>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toMatch(/<div[\s>]/);
    expect(html).not.toContain("Loading...");
  });

  test("async resolving to empty string renders empty", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("", 10));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <div>{data()}</div>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toMatch(/<div[\s>]/);
    expect(html).not.toContain("Loading...");
  });
});

describe("renderToString — Sync Rendering", () => {
  test("sync component renders to string", () => {
    const html = renderToString(() => (
      <div>
        <h1>Hello</h1>
        <p>World</p>
      </div>
    ));
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
  });

  test("nested sync components", () => {
    function Child(props: { name: string }) {
      return <span>{props.name}</span>;
    }
    function App() {
      return (
        <div>
          <Child name="Alice" />
          <Child name="Bob" />
        </div>
      );
    }

    const html = renderToString(() => <App />);
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
  });

  test("sync flow controls render correctly", () => {
    const html = renderToString(() => (
      <div>
        <Show when={true}>
          <p>Visible</p>
        </Show>
        <Show when={false}>
          <p>Hidden</p>
        </Show>
        <For each={["X", "Y"]}>{item => <span>{item()}</span>}</For>
      </div>
    ));
    expect(html).toContain("Visible");
    expect(html).not.toContain("Hidden");
    expect(html).toContain("X");
    expect(html).toContain("Y");
  });

  test("throws on async content without Loading boundary", () => {
    function App() {
      const data = createMemo(async () => asyncValue("Never", 10));
      return <p>{data()}</p>;
    }

    expect(() => renderToString(() => <App />)).toThrow();
  });

  test("noScripts suppresses script injection", () => {
    const html = renderToString(() => <div>Content</div>, { noScripts: true });
    expect(html).toContain("Content");
    expect(html).not.toContain("<script");
  });
});

describe("SSR Streaming — Callbacks", () => {
  test("onCompleteShell fires after blocking promises", async () => {
    let shellFired = false;
    let shellHtml = "";

    function App() {
      const data = createMemo(async () => asyncValue("Ready", 30), {
        deferStream: true
      });
      return (
        <Loading fallback={<span>Wait</span>}>
          <p>{data()}</p>
        </Loading>
      );
    }

    await new Promise<void>(resolve => {
      renderToStream(() => <App />, {
        onCompleteShell({ write }: { write: (v: string) => void }) {
          shellFired = true;
        }
      }).pipe({
        write(chunk: string) {
          if (shellFired && !shellHtml) shellHtml = chunk;
        },
        end() {
          resolve();
        }
      });
    });

    expect(shellFired).toBe(true);
    expect(shellHtml).toContain("Ready");
  });

  test("onCompleteAll fires after all fragments", async () => {
    let allFired = false;

    function App() {
      const data = createMemo(async () => asyncValue("Done", 20));
      return (
        <Loading fallback={<span>Loading</span>}>
          <p>{data()}</p>
        </Loading>
      );
    }

    const html = await new Promise<string>(resolve => {
      renderToStream(() => <App />, {
        onCompleteAll() {
          allFired = true;
        }
      }).then(resolve);
    });

    expect(allFired).toBe(true);
    expect(html).toContain("Done");
  });
});

// ============================================================================
// Asset Discovery — modulepreload emission + per-boundary seroval data
// ============================================================================

describe("SSR Streaming — Asset Discovery", () => {
  test("first-level lazy emits modulepreload link in head", async () => {
    const manifest = {
      "./Home.tsx": { file: "assets/Home-abc.js", imports: ["_shared"] },
      _shared: { file: "assets/shared-def.js" }
    };

    const Home = (props: any) => <div>Home Content</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), "./Home.tsx");
    await LazyHome.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <LazyHome />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    expect(shell).toContain('<link rel="modulepreload" href="/assets/Home-abc.js">');
    expect(shell).toContain('<link rel="modulepreload" href="/assets/shared-def.js">');
    expect(shell).toContain("Home Content");
  });

  test("lazy with no manifest throws during render", async () => {
    const Home = (props: any) => <div>Home</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), "./Home.tsx");
    await LazyHome.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <LazyHome />
            </Loading>
          </body>
        </html>
      );
    }

    await expect(collectChunks(() => <App />)).rejects.toThrow(/asset manifest/);
  });

  test("deduplicates modulepreload links across boundaries", async () => {
    const manifest = {
      "./A.tsx": { file: "assets/A.js", imports: ["_shared"] },
      "./B.tsx": { file: "assets/B.js", imports: ["_shared"] },
      _shared: { file: "assets/shared.js" }
    };

    const CompA = () => <div>A</div>;
    const CompB = () => <div>B</div>;
    const LazyA = lazy(() => asyncValue({ default: CompA }), "./A.tsx");
    const LazyB = lazy(() => asyncValue({ default: CompB }), "./B.tsx");
    await LazyA.preload!();
    await LazyB.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading A...</span>}>
              <LazyA />
            </Loading>
            <Loading fallback={<span>Loading B...</span>}>
              <LazyB />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    const sharedCount = (shell.match(/modulepreload" href="\/assets\/shared\.js"/g) || []).length;
    expect(sharedCount).toBe(1);
    expect(shell).toContain('<link rel="modulepreload" href="/assets/A.js">');
    expect(shell).toContain('<link rel="modulepreload" href="/assets/B.js">');
  });

  test("$df remains pure DOM swap — no asset arguments", async () => {
    const manifest = {
      "./Lazy.tsx": { file: "assets/lazy.js" }
    };

    const Comp = () => <div>Streamed</div>;
    const LazyComp = lazy(
      () => new Promise<{ default: typeof Comp }>(r => setTimeout(() => r({ default: Comp }), 20)),
      "./Lazy.tsx"
    );

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <LazyComp />
            </Loading>
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    const dfCalls = html.match(/\$df\("[^"]+"\)/g) || [];
    for (const call of dfCalls) {
      expect(call).toMatch(/^\$df\("[^"]+"\)$/);
    }
  });

  test("per-boundary module map serialized via seroval", async () => {
    const manifest = {
      "./Comp.tsx": { file: "assets/comp.js", imports: ["_dep"] },
      _dep: { file: "assets/dep.js" }
    };

    const Comp = () => <div>Content</div>;
    const LazyComp = lazy(() => asyncValue({ default: Comp }), "./Comp.tsx");
    await LazyComp.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <LazyComp />
            </Loading>
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    expect(html).toContain("_assets");
    expect(html).toContain("./Comp.tsx");
    expect(html).toContain("/assets/comp.js");
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
    const assetScript = scripts.find(s => s.includes("_assets"));
    expect(assetScript).toBeDefined();
    expect(assetScript).toContain("./Comp.tsx");
    expect(assetScript).toContain("/assets/comp.js");
    expect(assetScript).not.toContain("/assets/dep.js");
  });

  test("nested lazy emits modulepreload before fragment template", async () => {
    const manifest = {
      "./Outer.tsx": { file: "assets/outer.js" },
      "./Inner.tsx": { file: "assets/inner.js" }
    };

    const InnerComp = () => <span>Inner</span>;
    const LazyInner = lazy(() => asyncValue({ default: InnerComp }, 10), "./Inner.tsx");

    const OuterComp = () => (
      <div>
        Outer
        <Loading fallback={<span>Loading Inner...</span>}>
          <LazyInner />
        </Loading>
      </div>
    );
    const LazyOuter = lazy(
      () =>
        new Promise<{ default: typeof OuterComp }>(r =>
          setTimeout(() => r({ default: OuterComp }), 20)
        ),
      "./Outer.tsx"
    );

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading Outer...</span>}>
              <LazyOuter />
            </Loading>
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    expect(html).toContain('<link rel="modulepreload" href="/assets/outer.js">');
    expect(html).toContain("Outer");
    expect(html).toContain("Inner");
  });

  test("nested fragment folding serializes inner boundary module map", async () => {
    const manifest = {
      "./Inner.tsx": { file: "assets/inner.js" }
    };

    const InnerComp = () => <span>InnerContent</span>;
    const LazyInner = lazy(() => asyncValue({ default: InnerComp }, 5), "./Inner.tsx");

    function App() {
      const slowData = createMemo(async () => asyncValue("SlowData", 40));
      const fastData = createMemo(async () => asyncValue("FastData", 5));
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Outer loading</span>}>
              <p>{slowData()}</p>
              <Loading fallback={<span>Inner loading</span>}>
                <p>{fastData()}</p>
                <LazyInner />
              </Loading>
            </Loading>
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    expect(html).toContain("SlowData");
    expect(html).toContain("FastData");
    expect(html).toContain("InnerContent");
    expect(html).toContain("_assets");
    expect(html).toContain("./Inner.tsx");
    expect(html).toContain("/assets/inner.js");
  });
});

// ============================================================================
// CSS Asset Handling in Streaming
// ============================================================================

describe("SSR Streaming — CSS Asset Handling", () => {
  test("REPLACE_SCRIPT includes $dfs and $dfc helper definitions", async () => {
    const manifest = {
      "./Comp.tsx": { file: "assets/comp.js" }
    };

    const Comp = () => <div>Content</div>;
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./Comp.tsx");
    await LazyComp.preload!();
    const gate = deferred<string>();

    function AsyncGate() {
      const data = createMemo(async () => gate.promise);
      return <span>{data()}</span>;
    }

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <AsyncGate />
              <LazyComp />
            </Loading>
          </body>
        </html>
      );
    }

    const { chunks } = await collectChunks(() => <App />, {
      manifest,
      onCompleteShell() {
        queueMicrotask(() => gate.resolve("gate"));
      }
    });
    const streamOutput = chunks.slice(1).join("");
    expect(streamOutput).toContain("function $dfs(");
    expect(streamOutput).toContain("function $dfc(");
    expect(streamOutput).toContain("function $df(");
  });

  test("pre-flush lazy CSS goes to head and uses $df (not $dfs) at fragment resolution", async () => {
    const manifest = {
      "./Styled.tsx": { file: "assets/styled.js", css: ["assets/styled.css"] }
    };

    const StyledComp = () => <div>Styled</div>;
    const LazyStyled = lazy(() => Promise.resolve({ default: StyledComp }), "./Styled.tsx");
    await LazyStyled.preload!();
    const gate = deferred<string>();

    function AsyncGate() {
      const data = createMemo(async () => gate.promise);
      return <span>{data()}</span>;
    }

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <AsyncGate />
              <LazyStyled />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />, {
      manifest,
      onCompleteShell() {
        queueMicrotask(() => gate.resolve("gate"));
      }
    });
    expect(shell).toContain('<link rel="stylesheet" href="/assets/styled.css">');

    const streamOutput = chunks.slice(1).join("");
    expect(streamOutput).toContain("<template id=");
    expect(streamOutput).toContain("Styled");
    const inlineCssLinks = (
      streamOutput.match(/stylesheet" href="\/assets\/styled\.css" onload/g) || []
    ).length;
    expect(inlineCssLinks).toBe(0);

    expect(streamOutput).toMatch(/\$df\("[^"]+"\)/);
    expect(streamOutput).not.toMatch(/\$dfs\("/);
  });

  test("shared CSS between boundaries — only emitted once in head", async () => {
    const manifest = {
      "./A.tsx": { file: "assets/a.js", css: ["assets/shared.css"] },
      "./B.tsx": { file: "assets/b.js", css: ["assets/shared.css"] }
    };

    const CompA = () => <div>A</div>;
    const LazyA = lazy(() => asyncValue({ default: CompA }), "./A.tsx");
    await LazyA.preload!();

    const CompB = () => <div>B</div>;
    const LazyB = lazy(() => Promise.resolve({ default: CompB }), "./B.tsx");
    await LazyB.preload!();
    const gate = deferred<string>();

    function AsyncGate() {
      const data = createMemo(async () => gate.promise);
      return <span>{data()}</span>;
    }

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>A loading</span>}>
              <LazyA />
            </Loading>
            <Loading fallback={<span>B loading</span>}>
              <AsyncGate />
              <LazyB />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />, {
      manifest,
      onCompleteShell() {
        queueMicrotask(() => gate.resolve("gate"));
      }
    });
    const headCssCount = (shell.match(/stylesheet" href="\/assets\/shared\.css"/g) || []).length;
    expect(headCssCount).toBe(1);

    const streamOutput = chunks.slice(1).join("");
    const streamCssOnload = (
      streamOutput.match(/stylesheet" href="\/assets\/shared\.css" onload/g) || []
    ).length;
    expect(streamCssOnload).toBe(0);
  });
});

// ============================================================================
// renderToString — Asset Discovery
// ============================================================================

describe("renderToString — Asset Discovery", () => {
  test("lazy emits modulepreload link in head", () => {
    const manifest = {
      "./Home.tsx": { file: "assets/Home-abc.js", imports: ["_shared"] },
      _shared: { file: "assets/shared-def.js" }
    };

    const Home = (props: any) => <div>Home Content</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), "./Home.tsx");

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <LazyHome />
            </Loading>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain('<link rel="modulepreload" href="/assets/Home-abc.js">');
    expect(html).toContain('<link rel="modulepreload" href="/assets/shared-def.js">');
  });

  test("serializes module map for boundary", () => {
    const manifest = {
      "./Comp.tsx": { file: "assets/comp.js", imports: ["_dep"] },
      _dep: { file: "assets/dep.js" }
    };

    const Comp = () => <div>Content</div>;
    const LazyComp = lazy(() => asyncValue({ default: Comp }), "./Comp.tsx");

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <LazyComp />
            </Loading>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain('<link rel="modulepreload" href="/assets/dep.js">');
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
    const assetScript = scripts.find(s => s.includes("_assets"));
    expect(assetScript).toBeDefined();
    expect(assetScript).toContain("./Comp.tsx");
    expect(assetScript).toContain("/assets/comp.js");
    expect(assetScript).not.toContain("/assets/dep.js");
  });

  test("deduplicates modulepreload links across boundaries", () => {
    const manifest = {
      "./A.tsx": { file: "assets/A.js", imports: ["_shared"] },
      "./B.tsx": { file: "assets/B.js", imports: ["_shared"] },
      _shared: { file: "assets/shared.js" }
    };

    const CompA = () => <div>A</div>;
    const CompB = () => <div>B</div>;
    const LazyA = lazy(() => asyncValue({ default: CompA }), "./A.tsx");
    const LazyB = lazy(() => asyncValue({ default: CompB }), "./B.tsx");

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading A...</span>}>
              <LazyA />
            </Loading>
            <Loading fallback={<span>Loading B...</span>}>
              <LazyB />
            </Loading>
          </body>
        </html>
      ),
      { manifest }
    );
    const sharedCount = (html.match(/modulepreload" href="\/assets\/shared\.js"/g) || []).length;
    expect(sharedCount).toBe(1);
    expect(html).toContain('<link rel="modulepreload" href="/assets/A.js">');
    expect(html).toContain('<link rel="modulepreload" href="/assets/B.js">');
  });

  test("serializes $$f marker for deferred boundary", () => {
    const manifest = {
      "./Home.tsx": { file: "assets/Home.js" }
    };

    const Home = () => <div>Home</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), "./Home.tsx");

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <LazyHome />
            </Loading>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain('"$$f"');
    expect(html).toContain("Loading...");
  });

  test("does not serialize async data (promises)", () => {
    const manifest = {
      "./Profile.tsx": { file: "assets/profile.js" }
    };

    const Profile = (props: any) => <div>{props.name}</div>;
    const LazyProfile = lazy(() => asyncValue({ default: Profile }), "./Profile.tsx");

    function App() {
      const data = createMemo(() => asyncValue("Jon", 100));
      return (
        <Loading fallback={<span>Loading...</span>}>
          <LazyProfile name={data()} />
        </Loading>
      );
    }

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <App />
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain("_assets");
    expect(html).toContain('"$$f"');
    expect(html).not.toContain("new Promise");
  });

  test("lazy with no manifest throws", () => {
    const Home = () => <div>Home</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), "./Home.tsx");

    expect(() =>
      renderToString(() => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <LazyHome />
            </Loading>
          </body>
        </html>
      ))
    ).toThrow(/asset manifest/);
  });
});

// ============================================================================
// Entry CSS Auto-Discovery
// ============================================================================

describe("Entry CSS Auto-Discovery", () => {
  test("entry CSS is injected into head via registerEntryAssets (streaming)", async () => {
    const manifest = {
      "src/index.tsx": { file: "assets/index-abc.js", isEntry: true, css: ["assets/main.css"] },
      "./Lazy.tsx": { file: "assets/lazy.js", isDynamicEntry: true }
    };

    const Comp = () => <div>Content</div>;
    const LazyComp = lazy(() => asyncValue({ default: Comp }), "./Lazy.tsx");
    await LazyComp.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <LazyComp />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    expect(shell).toContain('<link rel="stylesheet" href="/assets/main.css">');
    expect(shell).toContain('<link rel="modulepreload" href="/assets/lazy.js">');
  });

  test("entry CSS is injected into head via registerEntryAssets (renderToString)", () => {
    const manifest = {
      "src/index.tsx": { file: "assets/index-abc.js", isEntry: true, css: ["assets/main.css"] }
    };

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <div>Hello</div>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain('<link rel="stylesheet" href="/assets/main.css">');
  });

  test("entry CSS from transitive imports is collected", async () => {
    const manifest = {
      "src/index.tsx": { file: "assets/index.js", isEntry: true, imports: ["src/shared.tsx"] },
      "src/shared.tsx": { file: "assets/shared.js", css: ["assets/shared.css"] }
    };

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <div>Hello</div>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).toContain('<link rel="stylesheet" href="/assets/shared.css">');
  });

  test("no entry in manifest — no CSS injected, no crash", () => {
    const manifest = {
      "./Lazy.tsx": { file: "assets/lazy.js", isDynamicEntry: true }
    };

    const html = renderToString(
      () => (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <div>Hello</div>
          </body>
        </html>
      ),
      { manifest }
    );
    expect(html).not.toContain("stylesheet");
  });

  test("entry CSS deduplicates with lazy component CSS (streaming)", async () => {
    const manifest = {
      "src/index.tsx": { file: "assets/index.js", isEntry: true, css: ["assets/shared.css"] },
      "./Styled.tsx": {
        file: "assets/styled.js",
        isDynamicEntry: true,
        css: ["assets/shared.css", "assets/styled.css"]
      }
    };

    const Comp = () => <div>Styled</div>;
    const LazyComp = lazy(() => asyncValue({ default: Comp }), "./Styled.tsx");
    await LazyComp.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Wait</span>}>
              <LazyComp />
            </Loading>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    const sharedCssCount = (shell.match(/stylesheet" href="\/assets\/shared\.css"/g) || []).length;
    expect(sharedCssCount).toBe(1);
    expect(shell).toContain('<link rel="stylesheet" href="/assets/styled.css">');
  });
});

// ============================================================================
// Fragment + props.children — SSR rendering correctness (PR #2592)
// ============================================================================

describe("SSR — Fragment wrapping props.children", () => {
  test("fragment wrapper renders children correctly in renderToString", () => {
    function Wrapper(props: { children: any }) {
      return <>{props.children}</>;
    }

    const html = renderToString(() => (
      <div>
        <Wrapper>
          <h1>Title</h1>
          <p>Text</p>
          <span>42</span>
        </Wrapper>
      </div>
    ));

    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<p[^>]*>Text<\/p>/);
    expect(html).toMatch(/<span[^>]*>42<\/span>/);
  });

  test("fragment wrapper with dynamic expression renders correctly", () => {
    function Wrapper(props: { children: any }) {
      return <>{props.children}</>;
    }

    const [count] = createSignal(42);

    const html = renderToString(() => (
      <div>
        <Wrapper>
          <h1>Title</h1>
          <span>{count()}</span>
        </Wrapper>
      </div>
    ));

    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toContain("42");
  });

  test("nested fragment wrappers render correctly", () => {
    function Wrapper(props: { children: any }) {
      return <>{props.children}</>;
    }
    function OuterWrapper(props: { children: any }) {
      return <>{props.children}</>;
    }

    const [count] = createSignal(7);

    const html = renderToString(() => (
      <div>
        <OuterWrapper>
          <Wrapper>
            <h1>Nested</h1>
            <span>{count()}</span>
          </Wrapper>
        </OuterWrapper>
      </div>
    ));

    expect(html).toContain("Nested");
    expect(html).toContain("7");
  });

  test("fragment wrapper with async data in streaming", async () => {
    function Wrapper(props: { children: any }) {
      return <>{props.children}</>;
    }

    function App() {
      const data = createMemo(async () => {
        return new Promise<string>(r => setTimeout(() => r("Loaded"), 10));
      });
      return (
        <Loading fallback={<span>Loading...</span>}>
          <Wrapper>
            <h1>Static</h1>
            <p>{data()}</p>
          </Wrapper>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("Static");
    expect(html).toContain("Loaded");
  });

  test("fragment wrapper with lazy component — PR #2592 pattern", async () => {
    function Wrapper(props: { children: any }) {
      return <>{props.children}</>;
    }

    const [s] = createSignal(0);
    function HomeContent() {
      return (
        <Wrapper>
          <h1>Welcome to this Simple Routing Example</h1>
          <p>Click the links in the Navigation above to load different routes.</p>
          <span>{s()}</span>
        </Wrapper>
      );
    }

    const LazyHome = lazy(
      () =>
        new Promise<{ default: typeof HomeContent }>(r =>
          setTimeout(() => r({ default: HomeContent }), 10)
        ),
      "./Home"
    );

    const manifest = { "./Home": { file: "assets/Home.js" } };

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <Switch fallback={<span>Not found</span>}>
                <Match when={true}>
                  <LazyHome />
                </Match>
              </Switch>
            </Loading>
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    expect(html).toContain("Welcome to this Simple Routing Example");
    expect(html).toContain("Click the links");
    expect(html).toContain("0");
  });
});

// Insert effect alignment — PR #2592 hydration mismatch patterns
// These test that flow components and spread elements render correctly as
// template children, validating that owner tree slots align between SSR and client.
describe("SSR — insert effect alignment (PR #2592)", () => {
  test("Show as template child with sibling", () => {
    const html = renderToString(() => (
      <div>
        <Show when={true}>
          <span>Hello</span>
        </Show>
        <span>World</span>
      </div>
    ));
    expect(html).toMatch(/<span[^>]*>Hello<\/span>/);
    expect(html).toMatch(/<span[^>]*>World<\/span>/);
  });

  test("multiple Show siblings in template", () => {
    const [count, setCount] = createSignal(0);
    const html = renderToString(() => (
      <div>
        <div>{count()}</div>
        <Show when={true}>
          <button>Click me in first child</button>
        </Show>
        <Show when={true}>
          <button>Click me in second child</button>
        </Show>
      </div>
    ));
    expect(html).toContain("0");
    expect(html).toContain("Click me in first child");
    expect(html).toContain("Click me in second child");
  });

  test("For as template child with sibling", () => {
    const html = renderToString(() => (
      <div>
        <For each={[1, 2, 3]}>{item => <li>{item()}</li>}</For>
        <span>after</span>
      </div>
    ));
    expect(html).toMatch(/<li[^>]*>1<\/li>/);
    expect(html).toMatch(/<li[^>]*>2<\/li>/);
    expect(html).toMatch(/<li[^>]*>3<\/li>/);
    expect(html).toMatch(/<span[^>]*>after<\/span>/);
  });

  test("Repeat as template child nests hydration keys before following sibling", () => {
    const html = renderToString(() => (
      <div>
        <Repeat count={3}>{i => <span>{i}</span>}</Repeat>
        <p>after</p>
      </div>
    ));
    const keys = extractHydrationKeys(html);

    // The outer <div> gets slot 0. Repeat consumes its own owner slot (t1),
    // then each item owner nests beneath it (t10, t11, t12), and each <span>
    // is rendered under that item scope.
    expect(keys).toEqual(["0", "100", "110", "120"]);
  });

  test("spread element renders correctly — PR #2592 spread pattern", () => {
    function Link(props: { count: number }) {
      const linkProps = {
        href: "/"
      };
      return <a {...linkProps}>My Link {props.count}</a>;
    }

    const html = renderToString(() => (
      <div>
        <Link count={1} />
        <Link count={2} />
      </div>
    ));
    expect(html).toContain("My Link");
    expect(html).toContain("1");
    expect(html).toContain("2");
  });

  test("dynamic expression + Show + spread siblings", () => {
    const [count] = createSignal(42);

    function Link(props: { label: string }) {
      const linkProps = { href: "/" };
      return <a {...linkProps}>{props.label}</a>;
    }

    const html = renderToString(() => (
      <div>
        <span>{count()}</span>
        <Show when={true}>
          <p>Visible</p>
        </Show>
        <Link label="click" />
      </div>
    ));
    expect(html).toContain("42");
    expect(html).toMatch(/<p[^>]*>Visible<\/p>/);
    expect(html).toContain("click");
  });
});

// --- Phase 7: Reveal Streaming Integration ---

describe("SSR Streaming — Reveal", () => {
  test("sequential collapsed: shell contains first fallback, later slots deferred", async () => {
    function BoundaryA() {
      const data = createMemo(async () => asyncValue("A", 20));
      return <div>{data()}</div>;
    }
    function BoundaryB() {
      const data = createMemo(async () => asyncValue("B", 40));
      return <div>{data()}</div>;
    }
    function BoundaryC() {
      const data = createMemo(async () => asyncValue("C", 60));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal collapsed>
          <Loading fallback={<div>fallback-A</div>}>
            <BoundaryA />
          </Loading>
          <Loading fallback={<div>fallback-B</div>}>
            <BoundaryB />
          </Loading>
          <Loading fallback={<div>fallback-C</div>}>
            <BoundaryC />
          </Loading>
        </Reveal>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    expect(shell).toContain("fallback-A");
    expect(full).toContain("A");
    expect(full).toContain("B");
    expect(full).toContain("C");
    expect(full).toContain("$dfj");
    expect(full).toContain("$dflj");
  });

  test("sequential non-collapsed: all fallbacks visible in shell", async () => {
    function BoundaryFirst() {
      const data = createMemo(async () => asyncValue("first", 20));
      return <div>{data()}</div>;
    }
    function BoundarySecond() {
      const data = createMemo(async () => asyncValue("second", 40));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal>
          <Loading fallback={<div>fallback-1</div>}>
            <BoundaryFirst />
          </Loading>
          <Loading fallback={<div>fallback-2</div>}>
            <BoundarySecond />
          </Loading>
        </Reveal>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    expect(shell).toContain("fallback-1");
    expect(shell).toContain("fallback-2");
    expect(full).toContain("first");
    expect(full).toContain("second");
    expect(full).toContain("$dfj");
  });

  test("together mode: all fragments resolve before group activation", async () => {
    function BoundaryX() {
      const data = createMemo(async () => asyncValue("X", 20));
      return <div>{data()}</div>;
    }
    function BoundaryY() {
      const data = createMemo(async () => asyncValue("Y", 40));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal together>
          <Loading fallback={<div>wait-X</div>}>
            <BoundaryX />
          </Loading>
          <Loading fallback={<div>wait-Y</div>}>
            <BoundaryY />
          </Loading>
        </Reveal>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    expect(shell).toContain("wait-X");
    expect(shell).toContain("wait-Y");
    expect(full).toContain("X");
    expect(full).toContain("Y");
    expect(full).toContain("$dfj");
  });

  test("nested Reveal: outer sequential controls inner group", async () => {
    function Outer1() {
      const data = createMemo(async () => asyncValue("outer-1", 20));
      return <div>{data()}</div>;
    }
    function InnerA() {
      const data = createMemo(async () => asyncValue("inner-a", 30));
      return <div>{data()}</div>;
    }
    function InnerB() {
      const data = createMemo(async () => asyncValue("inner-b", 50));
      return <div>{data()}</div>;
    }
    function Outer2() {
      const data = createMemo(async () => asyncValue("outer-2", 60));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal collapsed>
          <Loading fallback={<div>outer-1-fb</div>}>
            <Outer1 />
          </Loading>
          <Reveal together>
            <Loading fallback={<div>inner-a-fb</div>}>
              <InnerA />
            </Loading>
            <Loading fallback={<div>inner-b-fb</div>}>
              <InnerB />
            </Loading>
          </Reveal>
          <Loading fallback={<div>outer-2-fb</div>}>
            <Outer2 />
          </Loading>
        </Reveal>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    expect(full).toContain("outer-1");
    expect(full).toContain("inner-a");
    expect(full).toContain("inner-b");
    expect(full).toContain("outer-2");
    expect(full).toContain("<template");
  });

  test("Loading without Reveal: no $dfj in output", async () => {
    function Content() {
      const data = createMemo(async () => asyncValue("plain-content", 20));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<div>plain-fb</div>}>
          <Content />
        </Loading>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    expect(full).toContain("plain-content");
    expect(full).toContain("$df(");
    // $dfj function definition appears in REPLACE_SCRIPT, but it should NOT be invoked
    expect(full).not.toMatch(/\$dfj\(\[/);
  });

  test("Reveal inside Loading: inner group operates independently", async () => {
    function InnerA() {
      const data = createMemo(async () => asyncValue("inner-A", 30));
      return <div>{data()}</div>;
    }
    function InnerB() {
      const data = createMemo(async () => asyncValue("inner-B", 50));
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<div>outer-fb</div>}>
          <Reveal together>
            <Loading fallback={<div>inner-A-fb</div>}>
              <InnerA />
            </Loading>
            <Loading fallback={<div>inner-B-fb</div>}>
              <InnerB />
            </Loading>
          </Reveal>
        </Loading>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    // Inner Loading boundaries return sync fallbacks, so the outer Loading
    // resolves synchronously — the shell contains inner fallback placeholders directly
    expect(shell).toContain("inner-A-fb");
    expect(shell).toContain("inner-B-fb");
    // All inner content eventually resolves in the stream
    expect(full).toContain("inner-A");
    expect(full).toContain("inner-B");
    // Inner Reveal group should produce $dfj for coordinated activation
    expect(full).toMatch(/\$dfj\(\[/);
  });

  test("out-of-order resolution: later slot resolving first does not appear before frontier", async () => {
    const { promise: pA, resolve: resolveA } = deferred<string>();
    const { promise: pB, resolve: resolveB } = deferred<string>();

    function SlotA() {
      const data = createMemo(async () => pA);
      return <div>{data()}</div>;
    }
    function SlotB() {
      const data = createMemo(async () => pB);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal collapsed>
          <Loading fallback={<div>fb-A</div>}>
            <SlotA />
          </Loading>
          <Loading fallback={<div>fb-B</div>}>
            <SlotB />
          </Loading>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);

    // Resolve B first (out of order)
    resolveB("resolved-B");
    await delay(20);
    // Then resolve A (the frontier)
    resolveA("resolved-A");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    // Both values should appear in the final output
    expect(full).toContain("resolved-A");
    expect(full).toContain("resolved-B");
    // Sequential mode should produce ordered $dfj activations
    expect(full).toContain("$dfj");
  });
});
