/**
 * @jsxImportSource @solidjs/web
 */
/**
 * #3734 — a `<Loading>` whose hole waits on an async value and then creates
 * a component that reads its own async source during setup. Each discovery
 * pass re-creates the component, and a re-created memo finds its settled
 * answer by owner id (`ctx[SLOTS]`, server signals.ts) — unless the source
 * hands back a fresh object per call and the slot is never consulted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStream, ssr, escape } from "@solidjs/web";
import { createComponent, createMemo, Loading } from "solid-js";

const tick = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 1));
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

type Source = () => any;
const sources: Record<string, () => { source: Source; fetches: () => number }> = {
  "same promise": () => {
    let fetches = 0;
    let p: Promise<string> | undefined;
    return { source: () => (p ||= (fetches++, tick("v"))), fetches: () => fetches };
  },
  // query()'s cache-hit shape: one request, a derived promise per call
  "derived promise": () => {
    let fetches = 0;
    let p: Promise<string> | undefined;
    return {
      source: () => (p ||= (fetches++, tick("v"))).then(v => v),
      fetches: () => fetches
    };
  },
  "same iterable": () => {
    let fetches = 0;
    let it: AsyncIterable<string> | undefined;
    return {
      source: () =>
        (it ||=
          (fetches++,
          (async function* () {
            yield await tick("v");
          })())),
      fetches: () => fetches
    };
  },
  // liveQuery()'s shape: one request, a fresh subscriber iterable per call
  "fresh iterable": () => {
    let fetches = 0;
    let p: Promise<string> | undefined;
    return {
      source: () => {
        const once = (p ||= (fetches++, tick("v")));
        return (async function* () {
          yield await once;
        })();
      },
      fetches: () => fetches
    };
  }
};

function render(code: () => any) {
  return Promise.race([
    new Promise<string>((resolve, reject) => {
      let html = "";
      renderToStream(code, { onError: reject }).pipe({
        write: (c: unknown) => void (html += String(c)),
        end: () => resolve(html)
      } as any);
    }),
    delay(2000).then(() => "TIMEOUT")
  ]);
}

describe("#3734 a hole re-creating a component that reads its own async source", () => {
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      errors.push(args.map(a => String(a?.message ?? a)).join(" "));
    });
  });
  afterEach(() => spy.mockRestore());

  describe.each(Object.keys(sources))("%s", name => {
    test("compiled holes", async () => {
      const { source, fetches } = sources[name]();
      let calls = 0;
      function Child() {
        const value = createMemo(() => (calls++, source()));
        const now = value();
        return <p>{now}</p>;
      }
      function App() {
        const user = createMemo(() => tick({ name: "u" }));
        return (
          <Loading fallback="loading">
            <div>{(user(), (<Child />) as any)}</div>
          </Loading>
        );
      }
      const html = await render(() => <App />);
      expect(errors).toEqual([]);
      expect(html).toMatch(/<p[^>]*>v<\/p>/);
      expect(fetches()).toBe(1);
      expect(calls).toBeLessThan(10);
    });

    // A hand-written ssr() hole continues `resolveIn`'s id counter across
    // passes, so the re-created memo's slot id moves each pass and no slot
    // memory can match it; only a source stable by identity converges.
    // Known open half of #3734.
    (name === "same promise" ? test : test.fails)("hand-written ssr()", async () => {
      const { source, fetches } = sources[name]();
      let calls = 0;
      const Child = () => {
        const value = createMemo(() => (calls++, source()));
        const now = value();
        return ssr(["<p>", "</p>"], escape(now));
      };
      const App = () => {
        const user = createMemo(() => tick({ name: "u" }));
        return createComponent(Loading, {
          fallback: "loading",
          get children() {
            return ssr(["<div>", "</div>"], () => (user(), createComponent(Child, {})));
          }
        });
      };
      const html = await render(() => createComponent(App, {}));
      expect(errors).toEqual([]);
      expect(html).toMatch(/<p>v<\/p>/);
      expect(fetches()).toBe(1);
      expect(calls).toBeLessThan(10);
    });
  });

  test("a pass disposed while the iterable's first value waits on a pending read", async () => {
    let calls = 0;
    function App() {
      const gate = createMemo(() => tick("g"));
      const source = () =>
        (async function* () {
          yield "v" + gate();
        })();
      function Child() {
        const value = createMemo(() => (calls++, source()));
        const now = value();
        return <p>{now}</p>;
      }
      function Slow() {
        const s = createMemo(() => delay(5).then(() => "s"));
        return <b>{s()}</b>;
      }
      return (
        <Loading fallback="loading">
          <div>
            <Child />
          </div>
          <Slow />
        </Loading>
      );
    }
    const html = await render(() => <App />);
    expect(errors).toEqual([]);
    expect(html).toMatch(/<p[^>]*>vg<\/p>/);
    expect(calls).toBeLessThan(10);
  });

  test("the serialized stream of a re-created node keeps its later yields", async () => {
    let fetches = 0;
    let p: Promise<string> | undefined;
    const source = () => {
      const once = (p ||= (fetches++, tick("v")));
      return (async function* () {
        yield await once;
        yield await delay(20).then(() => "later-yield");
      })();
    };
    function Child() {
      const value = createMemo(() => source());
      const now = value();
      return <p>{now}</p>;
    }
    function App() {
      const user = createMemo(() => tick({ name: "u" }));
      return (
        <Loading fallback="loading">
          <div>{(user(), (<Child />) as any)}</div>
        </Loading>
      );
    }
    const html = await render(() => <App />);
    expect(errors).toEqual([]);
    expect(html).toMatch(/<p[^>]*>v<\/p>/);
    expect(html).toContain("later-yield");
    expect(fetches).toBe(1);
  });
});
