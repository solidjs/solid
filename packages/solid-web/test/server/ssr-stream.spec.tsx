/**
 * @jsxImportSource @solidjs/web
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
  Errored,
  dynamic,
  Dynamic
} from "@solidjs/web";
import {
  NoHydration,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  isPending,
  lazy,
  type Component
} from "solid-js";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

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
  test("preserves hydration key order when deferred children precede a sibling", async () => {
    function Parent(props: { children: any }) {
      return (
        <div>
          {props.children}
          <Sibling />
        </div>
      );
    }

    function Child() {
      return <span>child</span>;
    }

    function Sibling() {
      return <span>sibling</span>;
    }

    const html = await renderComplete(() => (
      <Parent>
        <Child />
      </Parent>
    ));

    // The deferred `props.children` hole owns id scope "1" (hole owner), so
    // its content ids nest under it ("10") while the eager sibling keeps the
    // parent-counter slot ("2") regardless of when the hole evaluates.
    expect(html).toContain("<span _hk=10>child</span><!--/--><!--$--><span _hk=2>sibling</span>");
  });

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

  test("top-level isPending guard follows Loading path without boundary", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Ready", 20));
      return <button disabled={isPending(data)}>{data()}</button>;
    }

    const { shell } = await collectChunks(() => <App />);
    expect(shell).toContain("<button");
    expect(shell).toContain("Ready");
    expect(shell).not.toContain("disabled");
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

  test("isPending guard follows Loading path inside Loading boundary", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Ready", 20));
      return (
        <Loading fallback={<button disabled>Loading...</button>}>
          <button disabled={isPending(data)}>{data()}</button>
        </Loading>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("<button");
    expect(shell).toContain("disabled");
    expect(shell).toContain("Loading...");
    expect(full).toContain("<button");
    expect(full).toContain("Ready");
  });

  test("bare async memo as direct Loading child (issue #2677)", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("Bare Data", 20));
      return (
        <div>
          <Loading fallback={<span>Loading...</span>}>{data()}</Loading>
        </div>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).toContain("Loading...");
    expect(full).toContain("Bare Data");
  });

  test("bare rejected async memo under Errored inside Loading resolves to error fallback", async () => {
    function App() {
      const data = createMemo<{ title: string }>(() =>
        Promise.reject(new Error("boom")).catch(e => {
          throw e;
        })
      );
      return (
        <div>
          <Loading fallback={<span>Pending</span>}>
            <Errored fallback={(e: any) => <span>err: {e().message}</span>}>{data().title}</Errored>
          </Loading>
        </div>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("err:");
    expect(html).toContain("boom");
    expect(html).not.toContain("tracking scope");
  });

  test("rejected lazy() under Errored serializes the error instead of hanging (#2780)", async () => {
    const manifest = { "./Boom.tsx": { file: "assets/boom.js" } };
    const LazyBoom = lazy(
      () => new Promise<any>((_, rej) => setTimeout(() => rej(new Error("lazy failed")), 10)),
      undefined,
      "./Boom.tsx"
    ) as any;

    // Without the rejection capture in lazy(), the failed module load left the
    // render memo throwing NotReadyError forever (the stream never completes)
    // and leaked a process-level unhandledRejection. The render now completes:
    // the fragment channel carries the error (`_fr` rejects with the payload)
    // and the client re-renders the subtree fresh — re-importing the module
    // and routing a repeat failure to its own Errored. The boundary id must
    // NOT carry an error record (#2997): the server rendered no fallback DOM,
    // so a record would derail the hydrating Errored into claiming markup
    // that does not exist.
    const html = await renderComplete(
      () => (
        <Errored fallback={(e: any) => <span>err: {String(e()?.message || e())}</span>}>
          <Loading fallback={<span>Pending</span>}>
            <LazyBoom />
          </Loading>
        </Errored>
      ),
      { manifest }
    );
    const rKeys = hydrationRecordKeys(html);
    // Error captured (it rides the rejected fragment), the streamed fragment
    // settled, and the shell did not get stuck on the placeholder.
    expect(html).toContain("lazy failed");
    expect(rKeys).not.toContain("0");
    expect(rKeys).toContain("000_fr");
  });

  test("pre-flush rejection under Errored > Loading rejects the fragment without a boundary error record (#2997)", async () => {
    // Rejects before its first await — the rejection lands before the shell
    // can flush.
    function Child() {
      const data = createMemo(async (): Promise<string> => {
        throw new Error("boom");
      });
      return <span>value:{data()}</span>;
    }

    const html = await renderComplete(() => (
      <div>
        <Errored fallback={<p>caught</p>}>
          <Loading fallback={<i>loading</i>}>
            <Child />
          </Loading>
        </Errored>
        <span>tail</span>
      </div>
    ));

    const rKeys = hydrationRecordKeys(html);
    // The fragment channel owns the error: `_fr` rejects (the client
    // re-renders the subtree fresh and its Errored catches), and the memo's
    // rejected flight is serialized for adoption. The Errored boundary id
    // must NOT carry an error record — the server never rendered fallback
    // DOM for it, so a record would make the hydrating client claim against
    // markup that does not exist and derail hydration into a blank page.
    expect(html).toContain("tail");
    expect(html).toContain("boom");
    expect(rKeys.sort()).toEqual(["100000", "100_fr"]);
    // The static sibling survives; neither fallback is server-rendered.
    expect(html).not.toContain("caught");
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
        <Errored fallback={err => <span>Error: {String(err())}</span>}>
          <Loading fallback={<span>Loading...</span>}>
            <p>{data()}</p>
          </Loading>
        </Errored>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const html = chunks.join("");

    expect(shell).toContain("Loading...");
    expect(shell).not.toContain("Boom");
    // The fallback is not server-rendered: the boundary streams an empty swap
    // and rejects its `_fr` resolver so the client's Errored fallback takes
    // over. The error must cross the stream by message alone — the stack is
    // stripped outside development (it leaks server paths), so nothing may
    // assert on stack text here.
    expect(html).toContain('new Error("Boom")');
    expect(hydrationRecordKeys(html)).toContain("100_fr");
  });

  test("isPending inside an Errored fallback resolves to false on the errored source (#2790)", async () => {
    // Server parity for the client #2790 fix. The server uses its own pull-based
    // primitives (packages/solid/src/server/signals.ts): `isPending` runs the
    // thunk once and swallows non-NotReadyErrors, the async memo read throws the
    // stored (real) error, and there is no observer graph / retry-on-read. So
    // `isPending(data)` on the errored source is false, the `<Show>` renders
    // nothing, the render completes, and no unhandled rejection escapes.
    function App() {
      const data = createMemo(async () => {
        await delay(10);
        throw new Error("Boom");
      });
      return (
        <Loading fallback={<span>Loading...</span>}>
          <Errored
            fallback={(err: any) => (
              <div>
                <span>err: {String(err()?.message ?? err())}</span>
                <Show when={isPending(data)}>
                  <span>resetting</span>
                </Show>
              </div>
            )}
          >
            <p>{data()}</p>
          </Errored>
        </Loading>
      );
    }

    const html = await renderComplete(() => <App />);
    expect(html).toContain("err:");
    expect(html).toContain("Boom");
    expect(html).not.toContain("resetting");
  });

  test("Errored wrapping Loading streams resolved async siblings once (#2726)", async () => {
    function Test(props: { id: string }) {
      const data = createMemo(async () => asyncValue(props.id, 0));

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

    const html = await renderComplete(() => <App />);
    expect([...html.matchAll(/class="test-block"/g)]).toHaveLength(2);
    expect(html).toContain('_hk=200000 class="test-block"');
    expect(html).toContain('_hk=500000 class="test-block"');
    const rKeys = hydrationRecordKeys(html);
    expect(rKeys).toContain("200_fr");
    expect(rKeys).toContain("500_fr");
    expect(html).toContain("Test query result: <!--$-->key-1<!--/-->");
    expect(html).toContain("Test query result: <!--$-->key-2<!--/-->");
  });

  test("Loading wrapping Errored streams rejected sibling with reset button", async () => {
    function Item(props: { id: string }) {
      const data = createMemo(async () => {
        await delay(10);
        if (props.id !== "1") throw new Error(`Item ${props.id} not found`);
        return { title: "Test Item" };
      });

      return (
        <Loading fallback={<div>Item Loading...</div>}>
          <Errored
            fallback={error => (
              <div>
                <div>ItemError: {String(error())}</div>
                <button>Reset to valid item</button>
              </div>
            )}
          >
            <div>{data().title}</div>
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

    const html = await renderComplete(() => <App />);
    expect([...html.matchAll(/Reset to valid item/g)]).toHaveLength(1);
    expect(html).toContain("_hk=200000");
    expect(html).toContain("_hk=40010");
    expect(html).toContain('_$HY.r["4000"]');
    expect(html).toContain("ItemError:");
    expect(html).toContain("Item bad-item not found");
  });

  test("async memo created inside Errored settles instead of looping (#2809)", async () => {
    // The boundary used to discard its partial template when children went
    // async and dispose + re-run them on every retry pull — recreating the
    // memo (and its fetch) each pass, so the render never completed. The
    // boundary now resumes its surviving holes across retries.
    let fetches = 0;
    function Child() {
      const posts = createMemo(() => {
        fetches++;
        return asyncValue([{ id: 1 }], 10);
      });
      return <span>{posts()[0].id}</span>;
    }

    const html = await renderComplete(() => (
      <Loading fallback="loading…">
        <Errored fallback={err => "caught: " + String(err())}>
          <Child />
        </Errored>
      </Loading>
    ));

    expect(html).toMatch(/<span[^>]*>1<\/span>/);
    expect(html).not.toContain("caught:");
    expect(fetches).toBe(1);
  });

  test("rejected async memo created inside Errored renders fallback (#2809)", async () => {
    let fetches = 0;
    function Child() {
      const posts = createMemo(async () => {
        fetches++;
        await delay(10);
        throw new Error("posts failed");
      });
      return <>{(posts() as any)[0].id}</>;
    }

    const html = await renderComplete(() => (
      <Loading fallback="loading…">
        <Errored fallback={err => "caught: " + ((err() as Error)?.message ?? String(err()))}>
          <Child />
        </Errored>
      </Loading>
    ));

    expect(html).toContain("caught: posts failed");
    expect(fetches).toBe(1);
  });

  test("stream completes after error (no hang)", async () => {
    function App() {
      const data = createMemo(async () => {
        await delay(10);
        throw new Error("Fail");
      });
      return (
        <Errored fallback={() => <span>Caught</span>}>
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

describe("SSR Streaming — Pending reads must not loop the boundary (#2801)", () => {
  test("Loading > Errored > nested async memo settles once", async () => {
    let fetches = 0;
    function Inner() {
      const data = createMemo(async () => {
        fetches++;
        return asyncValue("nested-content", 20);
      });
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<div>loading...</div>}>
          <Errored fallback={e => <div>error: {String(e())}</div>}>
            <Inner />
          </Errored>
        </Loading>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("nested-content");
    expect(fetches).toBe(1);
  });

  test("createEffect reading an async memo inside Loading settles", async () => {
    let fetches = 0;
    function Inner() {
      const data = createMemo(async () => {
        fetches++;
        return asyncValue("effect-content", 20);
      });
      createEffect(
        () => data(),
        () => {}
      );
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<div>loading...</div>}>
          <Inner />
        </Loading>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("effect-content");
    expect(fetches).toBe(1);
  });

  test("createEffect reading an async memo outside Loading settles", async () => {
    let fetches = 0;
    function App() {
      const data = createMemo(async () => {
        fetches++;
        return asyncValue("outside-content", 20);
      });
      createEffect(
        () => data(),
        () => {}
      );
      return (
        <Loading fallback={<div>loading...</div>}>
          <div>{data()}</div>
        </Loading>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("outside-content");
    expect(fetches).toBe(1);
  });

  test("createRenderEffect reading an async memo retries with the settled value", async () => {
    let fetches = 0;
    let effectRuns = 0;
    let effectValue: any;
    function Inner() {
      const data = createMemo(async () => {
        fetches++;
        return asyncValue("render-effect-content", 20);
      });
      createRenderEffect(
        () => data(),
        v => {
          effectRuns++;
          effectValue = v;
        }
      );
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<div>loading...</div>}>
          <Inner />
        </Loading>
      );
    }

    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("render-effect-content");
    expect(fetches).toBe(1);
    expect(effectRuns).toBe(1);
    expect(effectValue).toBe("render-effect-content");
  });

  test("failed pulls do not leak hydration key slots (async && before <For>)", async () => {
    function App() {
      const data = createMemo(async () => asyncValue({ value: "shown" }, 20));
      const [items] = createSignal(["a", "b"]);
      return (
        <Loading fallback={<div>loading</div>}>
          {data().value && <h4>{data().value}</h4>}
          <For each={items()}>{x => <div>{x}</div>}</For>
        </Loading>
      );
    }
    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    // Each NotReadyError pull of the compiler-emitted condition memo must not
    // consume a child-id slot, or the h4's key drifts ahead of the client's
    // single successful compute (was _hk=10003) and the node goes unclaimed.
    expect(full).toContain("<h4 _hk=10001>shown</h4>");
    expect(full).toContain("<div _hk=100100>a</div>");
    expect(full).toContain("<div _hk=100110>b</div>");
  });

  test("top-level render effect holds shell flush until its async source settles", async () => {
    let effectValue: any;
    let effectRanBeforeShell = false;
    let shellFlushed = false;
    function App() {
      const data = createMemo(async () => asyncValue("top-content", 20));
      createRenderEffect(
        () => data(),
        v => {
          effectValue = v;
          effectRanBeforeShell = !shellFlushed;
        }
      );
      return <div>static</div>;
    }
    await new Promise<void>(resolve => {
      renderToStream(() => <App />).pipe({
        write() {
          shellFlushed = true;
        },
        end() {
          resolve();
        }
      });
    });
    expect(effectValue).toBe("top-content");
    expect(effectRanBeforeShell).toBe(true);
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
            <For each={items()}>{item => <li>{item}</li>}</For>
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

  // A chained async memo reached through a SYNC derived memo must serialize its
  // resolved VALUE, including inside a NESTED Loading boundary. `b` only resolves
  // after `a`, so when nested it serializes *after* the surrounding boundary has
  // already flushed/committed. Previously that late serialization landed in a
  // buffer that never flushed again, dropping `b`'s value — the client then
  // re-ran the compute and orphaned the server fragment ("unclaimed
  // server-rendered node"). This is the shape TanStack Start produces (route
  // content nested in the root layout's boundary).
  const fetchItems = async (id: number) => ["item " + id];
  function ChainedInner() {
    const a = createMemo(async () => asyncValue([1], 10));
    const m = createMemo(() => a()[0]); // sync — re-throws while a is pending
    const b = createMemo(() => fetchItems(m())); // body throws synchronously first pass
    return (
      <Loading fallback={<div>loading</div>}>
        <For each={b()}>{x => <div>{x}</div>}</For>
      </Loading>
    );
  }

  test("serializes chained memo value (single boundary)", async () => {
    const html = await renderComplete(() => <ChainedInner />);
    expect(html).toMatch(/=\[1\]/);
    expect(html).toContain(`["item 1"]`);
  });

  test("serializes chained memo value (nested boundary)", async () => {
    const html = await renderComplete(() => (
      <Loading fallback={<div>outer</div>}>
        <ChainedInner />
      </Loading>
    ));
    expect(html).toMatch(/=\[1\]/);
    expect(html).toContain(`["item 1"]`);
  });

  test("serializes chained memo value (deeply nested boundaries)", async () => {
    const html = await renderComplete(() => (
      <Loading fallback={<div>l1</div>}>
        <Loading fallback={<div>l2</div>}>
          <ChainedInner />
        </Loading>
      </Loading>
    ));
    expect(html).toContain(`["item 1"]`);
  });

  test("serializes chained memo value (nested boundary, awaited renderToStream)", async () => {
    const html = await renderToStream(() => (
      <Loading fallback={<div>outer</div>}>
        <ChainedInner />
      </Loading>
    ));
    expect(html).toContain(`["item 1"]`);
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
        <For each={["X", "Y"]}>{item => <span>{item}</span>}</For>
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
    const LazyHome = lazy(() => asyncValue({ default: Home }), undefined, "./Home.tsx");
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

  test("preload() hints a matched route that has not rendered yet", async () => {
    // The router's warm-up shape: the route is known from the URL and preloaded
    // before anything renders it, so its whole static graph rides the shell.
    const manifest = {
      "./Route.tsx": {
        file: "assets/Route-abc.js",
        css: ["assets/Route.css"],
        imports: ["_dep"]
      },
      _dep: { file: "assets/dep-def.js" }
    };

    const Route = (props: any) => <div>route body</div>;
    const LazyRoute = lazy(() => asyncValue({ default: Route }), undefined, "./Route.tsx");

    function App() {
      LazyRoute.preload!();
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <div>shell</div>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    expect(shell).toContain('<link rel="modulepreload" href="/assets/Route-abc.js">');
    expect(shell).toContain('<link rel="modulepreload" href="/assets/dep-def.js">');
    expect(shell).toContain('<link rel="stylesheet" href="/assets/Route.css">');
    // Hints only — the component itself never rendered.
    expect(shell).not.toContain("route body");
  });

  test("preload() under NoHydration hints css but not the module", async () => {
    const manifest = {
      "./Aside.tsx": { file: "assets/Aside-abc.js", css: ["assets/Aside.css"] }
    };

    const Aside = (props: any) => <div>aside</div>;
    const LazyAside = lazy(() => asyncValue({ default: Aside }), undefined, "./Aside.tsx");

    function Warm() {
      LazyAside.preload!();
      return null;
    }

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <NoHydration>
              <Warm />
            </NoHydration>
          </body>
        </html>
      );
    }

    const { shell } = await collectChunks(() => <App />, { manifest });
    // The server markup still needs its styles; nothing in there hydrates, so
    // the client never fetches the module.
    expect(shell).toContain('<link rel="stylesheet" href="/assets/Aside.css">');
    expect(shell).not.toContain("Aside-abc.js");
  });

  test("lazy with no manifest throws during render", async () => {
    const Home = (props: any) => <div>Home</div>;
    const LazyHome = lazy(() => asyncValue({ default: Home }), undefined, "./Home.tsx");
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
    const LazyA = lazy(() => asyncValue({ default: CompA }), undefined, "./A.tsx");
    const LazyB = lazy(() => asyncValue({ default: CompB }), undefined, "./B.tsx");
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
      undefined,
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
    const LazyComp = lazy(() => asyncValue({ default: Comp }), undefined, "./Comp.tsx");
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
    expect(html).toContain("/assets/comp.js");
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
    const assetScript = scripts.find(s => s.includes("_assets"));
    expect(assetScript).toBeDefined();
    // The mapping is keyed by the lazy render memo's hydration id — the raw
    // module specifier must not leak into the serialized payload.
    expect(assetScript).not.toContain("./Comp.tsx");
    expect(assetScript).toMatch(/\{[^{}]*:"\/assets\/comp\.js"\}/);
    expect(assetScript).not.toContain("/assets/dep.js");
  });

  test("nested lazy emits modulepreload before fragment template", async () => {
    const manifest = {
      "./Outer.tsx": { file: "assets/outer.js" },
      "./Inner.tsx": { file: "assets/inner.js" }
    };

    const InnerComp = () => <span>Inner</span>;
    const LazyInner = lazy(() => asyncValue({ default: InnerComp }, 10), undefined, "./Inner.tsx");

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
      undefined,
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
    const LazyInner = lazy(() => asyncValue({ default: InnerComp }, 5), undefined, "./Inner.tsx");

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
    // Keyed by hydration id; the entry URL is the value.
    expect(html).toMatch(/_assets"\]=\(?\$R\[\d+\]=\{[^{}]*:"\/assets\/inner\.js"\}/);
  });

  /**
   * #2860: a pending Loading leaked its asset-attribution scope to later
   * document-order siblings — the boundary set the shared boundary id at
   * creation (through the tracking accessor inherited from the root context)
   * and never restored it, so a root-level lazy() after the boundary filed
   * its module under the boundary's already-serialized map instead of the
   * root `_assets` map. The HTML and modulepreload looked fine, but the
   * client had no usable module mapping and the island never hydrated.
   */
  test("root-level lazy after a pending Loading serializes into the root asset map (#2860)", async () => {
    const manifest = {
      "./Route.tsx": { file: "assets/route.js" },
      "./Widget.tsx": { file: "assets/widget.js" }
    };

    const Route = () => {
      const product = createMemo(async () => asyncValue("Trail Pack", 20));
      return <main data-page="product">{product()}</main>;
    };
    const Widget = () => <aside data-widget="support">Chat with support</aside>;
    const LazyRoute = lazy(() => asyncValue({ default: Route }), undefined, "./Route.tsx");
    const LazyWidget = lazy(() => asyncValue({ default: Widget }), undefined, "./Widget.tsx");
    await LazyRoute.preload!();
    await LazyWidget.preload!();

    function App() {
      return (
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <Loading fallback={<p>Loading product...</p>}>
              <LazyRoute />
            </Loading>
            {/* Root-level lazy sibling after the pending boundary. */}
            <LazyWidget />
          </body>
        </html>
      );
    }

    const html = await renderComplete(() => <App />, { manifest });
    expect(html).toContain('data-widget="support"');
    expect(html).toContain("/assets/widget.js");

    // The sibling's module belongs to the root map (keyed by hydration id,
    // so match on the entry URL value)...
    const rootAssets = html.match(/_\$HY\.r\["_assets"\]=[^;]*/g) || [];
    expect(rootAssets.some(s => s.includes("/assets/widget.js"))).toBe(true);
    // ...and not to the boundary's map.
    const boundaryAssets = html.match(/_\$HY\.r\["[^"]+_assets"\]=[^;]*/g) || [];
    for (const map of boundaryAssets) {
      if (map.startsWith('_$HY.r["_assets"]')) continue;
      expect(map).not.toContain("/assets/widget.js");
    }
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
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Comp.tsx");
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
    const LazyStyled = lazy(
      () => Promise.resolve({ default: StyledComp }),
      undefined,
      "./Styled.tsx"
    );
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
    const LazyA = lazy(() => asyncValue({ default: CompA }), undefined, "./A.tsx");
    await LazyA.preload!();

    const CompB = () => <div>B</div>;
    const LazyB = lazy(() => Promise.resolve({ default: CompB }), undefined, "./B.tsx");
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
    const LazyHome = lazy(() => asyncValue({ default: Home }), undefined, "./Home.tsx");

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
    const LazyComp = lazy(() => asyncValue({ default: Comp }), undefined, "./Comp.tsx");

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
    // Keyed by the lazy render memo's hydration id, not the module specifier.
    expect(assetScript).not.toContain("./Comp.tsx");
    expect(assetScript).toMatch(/\{[^{}]*:"\/assets\/comp\.js"\}/);
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
    const LazyA = lazy(() => asyncValue({ default: CompA }), undefined, "./A.tsx");
    const LazyB = lazy(() => asyncValue({ default: CompB }), undefined, "./B.tsx");

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
    const LazyHome = lazy(() => asyncValue({ default: Home }), undefined, "./Home.tsx");

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
    const LazyProfile = lazy(() => asyncValue({ default: Profile }), undefined, "./Profile.tsx");

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
    const LazyHome = lazy(() => asyncValue({ default: Home }), undefined, "./Home.tsx");

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
    const LazyComp = lazy(() => asyncValue({ default: Comp }), undefined, "./Lazy.tsx");
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
    const LazyComp = lazy(() => asyncValue({ default: Comp }), undefined, "./Styled.tsx");
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
      undefined,
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
        <For each={[1, 2, 3]}>{item => <li>{item}</li>}</For>
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

describe("SSR — dynamic() Promise component sources (#2779)", () => {
  test("dynamic() awaits a Promise component source", async () => {
    function Inner(props: { name: string }) {
      return <span>Hello {props.name}</span>;
    }
    function App() {
      const Comp = dynamic<Component<{ name: string }>>(() =>
        asyncValue(Inner as Component<{ name: string }>, 10)
      );
      return (
        <div>
          <Comp name="Ada" />
        </div>
      );
    }
    const { chunks } = await collectChunks(() => <App />);
    expect(chunks.join("")).toMatch(/Hello\s*(<!--\$-->)?Ada/);
    // Awaited form — the shell must wait on the blocked root hole rather
    // than completing with an unfinished render (the "" from the issue).
    const awaited = await renderComplete(() => <App />);
    expect(awaited).toMatch(/Hello\s*(<!--\$-->)?Ada/);
  });

  test("dynamic() awaits a Promise tag-name source", async () => {
    function App() {
      const Comp = dynamic(() => asyncValue("span" as const, 10));
      return <Comp id="tag">tag content</Comp>;
    }
    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("<span");
    expect(full).toContain("tag content");
  });

  test("Dynamic awaits a Promise component prop", async () => {
    function Inner(props: { name: string }) {
      return <span>Hi {props.name}</span>;
    }
    function App() {
      return <Dynamic component={asyncValue(Inner, 10) as any} name="Bea" />;
    }
    const { chunks } = await collectChunks(() => <App />);
    expect(chunks.join("")).toMatch(/Hi\s*(<!--\$-->)?Bea/);
  });

  test("rejected Promise source surfaces to Errored", async () => {
    function App() {
      const Comp = dynamic(() => Promise.reject(new Error("load failed")) as Promise<"span">);
      return (
        <Errored fallback={e => <div>caught: {String(e())}</div>}>
          <Comp />
        </Errored>
      );
    }
    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("caught:");
    expect(full).toContain("load failed");
  });

  test("sync sources are unchanged (function and tag)", () => {
    function Inner(props: { name: string }) {
      return <b>{props.name}</b>;
    }
    const CompFn = dynamic(() => Inner);
    const CompTag = dynamic(() => "i" as const);
    const html = renderToString(() => (
      <div>
        <CompFn name="X" />
        <CompTag>italic</CompTag>
      </div>
    ));
    expect(html).toMatch(/<b[^>]*>(<!--\$-->)?X/);
    expect(html).toContain("italic");
  });
});

// --- Phase 7: Reveal Streaming Integration ---

describe("SSR Streaming — Reveal", () => {
  test("rejected boundary releases the sequential frontier (#2776)", async () => {
    // The error path of a streamed Loading used to skip the reveal-group
    // notification the success path sends, parking the sequential frontier on
    // the rejected slot: later siblings streamed their HTML but never got an
    // activation call.
    const { promise: pA, reject: rejectA } = deferred<string>();
    pA.catch(() => {});
    const { promise: pB, resolve: resolveB } = deferred<string>();

    function BadSlot() {
      const data = createMemo(async () => pA);
      return <div>{data()}</div>;
    }
    function GoodSlot() {
      const data = createMemo(async () => pB);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Errored fallback={e => <div>outer caught: {String(e())}</div>}>
          <Reveal>
            <Loading fallback={<div>fallback-A</div>}>
              <BadSlot />
            </Loading>
            <Loading fallback={<div>fallback-B</div>}>
              <GoodSlot />
            </Loading>
          </Reveal>
        </Errored>
      );
    }

    const chunksPromise = collectChunks(() => <App />);
    rejectA(new Error("A failed"));
    await delay(20);
    resolveB("B-content");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    expect(full).toContain("B-content");
    // B's slot must be activated, and only after its template streamed.
    const templateIdx = full.search(/<template id="(\d+)"><div[^>]*>B-content/);
    expect(templateIdx).toBeGreaterThan(-1);
    const key = full.match(/<template id="(\d+)"><div[^>]*>B-content/)![1];
    const activationIdx = full.indexOf(`$dfj(["${key}"])`);
    expect(activationIdx).toBeGreaterThan(templateIdx);
    // A's rejection is serialized so the client error path takes over.
    expect(full).toContain("A failed");
  });

  test("rejected boundary does not deadlock order=together (#2776)", async () => {
    // Together-release waits until every direct slot is minimally ready, which
    // for leaves is driven by the same onResolved the error path was skipping —
    // one rejected slot froze the whole group on fallbacks forever.
    const { promise: pA, reject: rejectA } = deferred<string>();
    pA.catch(() => {});
    const { promise: pB, resolve: resolveB } = deferred<string>();

    function BadSlot() {
      const data = createMemo(async () => pA);
      return <div>{data()}</div>;
    }
    function GoodSlot() {
      const data = createMemo(async () => pB);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Errored fallback={e => <div>outer caught: {String(e())}</div>}>
          <Reveal order="together">
            <Loading fallback={<div>fallback-A</div>}>
              <BadSlot />
            </Loading>
            <Loading fallback={<div>fallback-B</div>}>
              <GoodSlot />
            </Loading>
          </Reveal>
        </Errored>
      );
    }

    const chunksPromise = collectChunks(() => <App />);
    rejectA(new Error("A failed"));
    await delay(20);
    resolveB("B-content");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    // The stream completes (no deadlock) with B's content and an activation.
    expect(full).toContain("B-content");
    expect(full).toContain("$dfj");
    expect(full).toContain("A failed");
  });

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
        <Reveal order="together">
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

  test.each(["sequential", "together", "natural"] as const)(
    "together mode activates with an empty nested %s Reveal",
    async order => {
      const { promise, resolve } = deferred<string>();

      function AsyncContent() {
        const data = createMemo(async () => promise);
        return <div>{data()}</div>;
      }
      function App() {
        return (
          <Reveal order="together">
            <Loading fallback={<div>loading</div>}>
              <AsyncContent />
            </Loading>
            <Reveal order={order}>
              <aside>static content</aside>
            </Reveal>
          </Reveal>
        );
      }

      const chunksPromise = collectChunks(() => <App />);
      await delay(10);
      resolve("async content");

      const { chunks } = await chunksPromise;
      const full = chunks.join("");
      const key = full.match(/<template id="(\d+)"><div[^>]*>async content/)?.[1];
      const templateIndex = full.indexOf(`<template id="${key}">`);
      const activationIndex = full.indexOf(`$dfj(["${key}"])`);

      expect(full).toContain("static content");
      expect(key).toBeDefined();
      expect(activationIndex).toBeGreaterThan(templateIndex);
    }
  );

  test("empty composite does not make a together group ready before later slots register", async () => {
    const { promise: profile, resolve: resolveProfile } = deferred<string>();
    const { promise: slowCard, resolve: resolveSlowCard } = deferred<string>();

    function Profile() {
      const data = createMemo(async () => profile);
      return <h1>{data()}</h1>;
    }
    function SlowCard() {
      const data = createMemo(async () => slowCard);
      return <p>{data()}</p>;
    }
    function App() {
      return (
        <Reveal order="together">
          <Loading fallback={<b>loading profile</b>}>
            <Profile />
          </Loading>
          <Reveal order="together">
            <Reveal order="natural">
              <aside>static content</aside>
            </Reveal>
            <Loading fallback={<i>loading slow card</i>}>
              <SlowCard />
            </Loading>
          </Reveal>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);
    await delay(10);
    resolveProfile("profile");
    await delay(10);
    resolveSlowCard("slow card");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");
    const profileKey = full.match(/<template id="(\d+)"><h1[^>]*>profile/)?.[1];
    const profileActivationIndex = full.indexOf(`$dfj(["${profileKey}"])`);
    const slowTemplateIndex = full.indexOf(">slow card</p></template>");

    expect(profileKey).toBeDefined();
    expect(slowTemplateIndex).toBeGreaterThan(-1);
    expect(profileActivationIndex).toBeGreaterThan(slowTemplateIndex);
  });

  test("together mode releases when a nested natural composite is minimally ready", async () => {
    const { promise: profile, resolve: resolveProfile } = deferred<string>();
    const { promise: fastCard, resolve: resolveFastCard } = deferred<string>();
    const { promise: slowCard, resolve: resolveSlowCard } = deferred<string>();

    function Profile() {
      const data = createMemo(async () => profile);
      return <h1>{data()}</h1>;
    }
    function FastCard() {
      const data = createMemo(async () => fastCard);
      return <p>{data()}</p>;
    }
    function SlowCard() {
      const data = createMemo(async () => slowCard);
      return <p>{data()}</p>;
    }
    function App() {
      return (
        <Reveal order="together">
          <Loading fallback={<b>loading profile</b>}>
            <Profile />
          </Loading>
          <Reveal order="natural">
            <Reveal order="natural">
              <Loading fallback={<i>loading fast card</i>}>
                <FastCard />
              </Loading>
              <Loading fallback={<i>loading slow card</i>}>
                <SlowCard />
              </Loading>
            </Reveal>
          </Reveal>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);
    await delay(10);
    resolveFastCard("fast card");
    await delay(10);
    resolveProfile("profile");
    await delay(10);
    resolveSlowCard("slow card");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");
    const profileTemplate = full.match(/<template id="(\d+)"><h1[^>]*>profile/)?.[1];
    const fastTemplate = full.match(/<template id="(\d+)"><p[^>]*>fast card/)?.[1];
    const slowTemplate = full.match(/<template id="(\d+)"><p[^>]*>slow card/)?.[1];
    const profileTemplateIndex = full.indexOf(`<template id="${profileTemplate}">`);
    const profileActivationIndex = full.indexOf(`$dfj(["${profileTemplate}"])`);
    const fastActivationIndex = full.indexOf(`$dfj(["${fastTemplate}"])`);
    const slowTemplateIndex = full.indexOf(`<template id="${slowTemplate}">`);
    const slowActivationIndex = full.indexOf(`$dfj(["${slowTemplate}"])`);

    expect(profileTemplate).toBeDefined();
    expect(fastTemplate).toBeDefined();
    expect(slowTemplate).toBeDefined();
    expect(profileActivationIndex).toBeGreaterThan(profileTemplateIndex);
    expect(profileActivationIndex).toBeLessThan(slowTemplateIndex);
    expect(fastActivationIndex).toBeGreaterThan(profileTemplateIndex);
    expect(fastActivationIndex).toBeLessThan(slowTemplateIndex);
    expect(slowActivationIndex).toBeGreaterThan(slowTemplateIndex);
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
          <Reveal order="together">
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
          <Reveal order="together">
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

  test("natural mode: each fragment streams as its own data resolves", async () => {
    const { promise: pX, resolve: resolveX } = deferred<string>();
    const { promise: pY, resolve: resolveY } = deferred<string>();

    function BoundaryX() {
      const data = createMemo(async () => pX);
      return <div>{data()}</div>;
    }
    function BoundaryY() {
      const data = createMemo(async () => pY);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal order="natural">
          <Loading fallback={<div>wait-X</div>}>
            <BoundaryX />
          </Loading>
          <Loading fallback={<div>wait-Y</div>}>
            <BoundaryY />
          </Loading>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);

    // Resolve Y first — natural should stream Y immediately, not wait for X.
    resolveY("Y-val");
    await delay(20);
    resolveX("X-val");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    // Natural streams each fragment as its own data resolves. Both values
    // must appear in the final output; shell contents are timing-sensitive
    // here because Y resolves before shell capture completes in this test.
    expect(full).toContain("X-val");
    expect(full).toContain("Y-val");
    expect(full).toContain("$dfj");
  });

  test("natural inside sequential: inner streams independently; outer siblings wait for composite", async () => {
    const { promise: pOuter1, resolve: resolveOuter1 } = deferred<string>();
    const { promise: pInnerA, resolve: resolveInnerA } = deferred<string>();
    const { promise: pInnerB, resolve: resolveInnerB } = deferred<string>();
    const { promise: pOuter2, resolve: resolveOuter2 } = deferred<string>();

    function Outer1() {
      const data = createMemo(async () => pOuter1);
      return <div>{data()}</div>;
    }
    function InnerA() {
      const data = createMemo(async () => pInnerA);
      return <span>{data()}</span>;
    }
    function InnerB() {
      const data = createMemo(async () => pInnerB);
      return <span>{data()}</span>;
    }
    function Outer2() {
      const data = createMemo(async () => pOuter2);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal>
          <Loading fallback={<div>outer-1-fb</div>}>
            <Outer1 />
          </Loading>
          <Reveal order="natural">
            <Loading fallback={<span>inner-a-fb</span>}>
              <InnerA />
            </Loading>
            <Loading fallback={<span>inner-b-fb</span>}>
              <InnerB />
            </Loading>
          </Reveal>
          <Loading fallback={<div>outer-2-fb</div>}>
            <Outer2 />
          </Loading>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);

    // Resolve all outer + one inner. Natural children reveal themselves
    // independently, but the outer sequential frontier blocks outer-2 on
    // the natural composite being complete (inner-b is still pending).
    resolveOuter1("outer-1-val");
    resolveOuter2("outer-2-val");
    resolveInnerA("inner-a-val");
    await delay(20);
    resolveInnerB("inner-b-val");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    expect(full).toContain("outer-1-val");
    expect(full).toContain("inner-a-val");
    expect(full).toContain("inner-b-val");
    expect(full).toContain("outer-2-val");
    expect(full).toContain("$dfj");
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

  test("outer together + inner sequential: inner holds until outer together releases", async () => {
    const { promise: pA, resolve: resolveA } = deferred<string>();
    const { promise: pB, resolve: resolveB } = deferred<string>();
    const { promise: pC, resolve: resolveC } = deferred<string>();

    function A() {
      const data = createMemo(async () => pA);
      return <span>{data()}</span>;
    }
    function B() {
      const data = createMemo(async () => pB);
      return <span>{data()}</span>;
    }
    function C() {
      const data = createMemo(async () => pC);
      return <span>{data()}</span>;
    }
    function App() {
      return (
        <Reveal order="together">
          <Loading fallback={<span>a-fb</span>}>
            <A />
          </Loading>
          <Reveal>
            <Loading fallback={<span>b-fb</span>}>
              <B />
            </Loading>
            <Loading fallback={<span>c-fb</span>}>
              <C />
            </Loading>
          </Reveal>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);

    // Inner sequential's frontier (b) resolves first. Outer together holds
    // everything because direct child a hasn't resolved yet.
    resolveB("b-val");
    await delay(20);
    // a resolves — every direct slot of outer together is now minimally ready,
    // so outer together releases. Inner sequential flushes b (its frontier);
    // c stays held behind inner's own frontier until it resolves.
    resolveA("a-val");
    await delay(20);
    resolveC("c-val");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    expect(full).toContain("a-val");
    expect(full).toContain("b-val");
    expect(full).toContain("c-val");
    // The nested coordination emits $dfj reveal calls.
    expect(full).toContain("$dfj");
  });

  test("outer together + inner natural: inner streams only after outer together releases", async () => {
    const { promise: pA, resolve: resolveA } = deferred<string>();
    const { promise: pB, resolve: resolveB } = deferred<string>();
    const { promise: pC, resolve: resolveC } = deferred<string>();

    function A() {
      const data = createMemo(async () => pA);
      return <span>{data()}</span>;
    }
    function B() {
      const data = createMemo(async () => pB);
      return <span>{data()}</span>;
    }
    function C() {
      const data = createMemo(async () => pC);
      return <span>{data()}</span>;
    }
    function App() {
      return (
        <Reveal order="together">
          <Loading fallback={<span>a-fb</span>}>
            <A />
          </Loading>
          <Reveal order="natural">
            <Loading fallback={<span>b-fb</span>}>
              <B />
            </Loading>
            <Loading fallback={<span>c-fb</span>}>
              <C />
            </Loading>
          </Reveal>
        </Reveal>
      );
    }

    const chunksPromise = collectChunks(() => <App />);

    // Inner natural's b resolves first. Under plain natural it would stream
    // immediately, but the outer together is holding the whole subtree, so b's
    // swap is stashed until outer releases.
    resolveB("b-val");
    await delay(20);
    // a resolves — outer together now has every direct slot minimally ready
    // (inner natural is minimally ready via b). Release: a + b flush together;
    // c continues streaming per inner natural once it resolves.
    resolveA("a-val");
    await delay(20);
    resolveC("c-val");

    const { chunks } = await chunksPromise;
    const full = chunks.join("");

    expect(full).toContain("a-val");
    expect(full).toContain("b-val");
    expect(full).toContain("c-val");
    expect(full).toContain("$dfj");
  });
});
