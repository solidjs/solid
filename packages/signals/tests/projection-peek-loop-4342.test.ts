/**
 * #4342: a derived store's pass that peeks (untracked, `NotReadyError`
 * caught) at a memo built from one of its own leaves does not re-run without
 * bound. The peek of a pending memo links it, so the memo's change re-runs
 * the derive; the reader of the leaf is linked to the derive by the flight it
 * observed. A held frame keeps both links after the passes that dropped them
 * (A30). The derive's sync pass woke every reader linked to it, so a reader
 * that builds a fresh object (a query key) re-ran the memo, the memo re-ran
 * the derive, and the derive re-ran the reader, all in one flush. A pass of
 * a settled derive now wakes no reader; a landing still does (#4070).
 *
 * "issue": the report's shape (a query hook whose projection peeks at every
 * mounted hook's key on a cache miss, a keyed list of rows each with its own
 * hook, a parent key from an async memo). The regression of #4307: the wake
 * parks the rows' readers on the derive, so a row's key is still pending
 * when the derive's pass for the new parent key peeks at it.
 * "rows" / "direct": the same loop without boundaries or a row hook, through
 * a keyed `mapArray` and through a reader of the leaf with no list.
 * "other-source": the peeked key is pending on a different async memo, not on
 * the derive (this loop predates #4307).
 */
import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  NotReadyError,
  onCleanup,
  untrack
} from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await wait(0);
    flush();
  }
};
const peekAll = (peeks: Iterable<() => unknown>) => {
  for (const peek of peeks)
    try {
      untrack(peek);
    } catch (err) {
      if (!(err instanceof NotReadyError)) throw err;
    }
};
const resolveAll = (v: any): string =>
  typeof v === "function"
    ? resolveAll(v())
    : Array.isArray(v)
      ? v.map(resolveAll).join("")
      : String(v ?? "");

describe("#4342: a derive's peek at a reader of its own leaf", () => {
  it("issue: switching the parent key settles", async () => {
    const keys = new Set<() => { hash: string }>();
    let runs = 0;
    function useQuery<T>(keyFn: () => string, fetcher: () => Promise<T>) {
      const key = createMemo(() => ({ hash: keyFn() }));
      keys.add(key);
      onCleanup(() => keys.delete(key));
      const cache = new Map<string, { p: Promise<{ value: T }>; d?: T }>();
      const data = createProjection<{ value?: T }>(() => {
        const k = key().hash;
        let e = cache.get(k);
        if (!e) {
          const entry: { p: Promise<{ value: T }>; d?: T } = {
            p: fetcher().then(d => ((entry.d = d), { value: d }))
          };
          cache.set(k, (e = entry));
          peekAll(keys);
        }
        return e.d !== undefined ? { value: e.d } : e.p;
      }, {});
      return () => data.value as T;
    }
    const [id, setId] = createSignal("A");
    let release!: (v: { key: string }[]) => void;
    const later = new Promise<{ key: string }[]>(r => (release = r));
    const Item = (props: { link: string; item: { key: string } }) => {
      const opts = createMemo(() => {
        if (++runs > 200) throw new Error("runaway");
        return { link: props.link, item: props.item.key };
      });
      useQuery(
        () => `${opts().link}:${opts().item}`,
        async () => 0
      );
      return () => props.item.key;
    };
    const List = (props: { link: string }) => {
      const list = useQuery(
        () => props.link,
        () => (props.link === "A" ? Promise.resolve([{ key: "a" }]) : later)
      );
      return createLoadingBoundary(
        () =>
          createErrorBoundary(
            () =>
              mapArray(
                () => list(),
                x =>
                  untrack(() =>
                    Item({
                      get link() {
                        return props.link;
                      },
                      get item() {
                        return x();
                      }
                    })
                  ),
                { keyed: (x: { key: string }) => x.key }
              ),
            e => String(e())
          ),
        () => "..."
      );
    };
    let screen = "";
    const dispose = createRoot(d => {
      const link = createMemo(async () => {
        const v = id();
        await Promise.resolve();
        return v;
      });
      const out = createLoadingBoundary(
        () =>
          untrack(() =>
            List({
              get link() {
                return link();
              }
            })
          ),
        () => "..."
      );
      createRenderEffect(
        () => resolveAll(out),
        v => {
          screen = v;
        }
      );
      return d;
    });
    flush();
    await wait(20);
    expect(screen).toBe("a");
    const before = runs;
    setId("B");
    flush();
    await wait(20);
    release([{ key: "b" }]);
    await wait(20);
    expect(screen).toBe("b");
    expect(runs - before).toBeLessThan(10);
    dispose();
  });

  for (const mode of ["rows", "direct", "other-source"] as const) {
    it(`${mode}: the landing settles`, async () => {
      const [id, setId] = createSignal("A");
      const res: Record<string, (v: { key: string }[]) => void> = {};
      const slowRes: Record<string, (v: string) => void> = {};
      let runs = 0;
      let screen = "";
      const dispose = createRoot(d => {
        // "other-source": the readers wait on `slow`; the derive's input is sync.
        const link =
          mode === "other-source"
            ? id
            : createMemo(async () => {
                const v = id();
                await Promise.resolve();
                return v;
              });
        // The rows' other input: the parent key itself, else a slower memo.
        const slow =
          mode === "other-source"
            ? createMemo(() => {
                const v = id();
                return v === "A" ? v : new Promise<string>(r => (slowRes[v] = r));
              })
            : link;
        const peeks: (() => unknown)[] = [];
        const cache: Record<string, { p: Promise<{ rows: { key: string }[] }>; d?: any }> = {};
        const p = createProjection<{ rows?: { key: string }[] }>(() => {
          const k = link();
          let e = cache[k];
          if (!e) {
            const entry: (typeof cache)[string] = {
              p: new Promise<{ key: string }[]>(r => (res[k] = r)).then(
                v => ((entry.d = v), { rows: v })
              )
            };
            e = cache[k] = entry;
            peekAll(peeks);
          }
          return e.d ? { rows: e.d } : e.p;
        }, {});
        const row = (item: () => string | undefined) => {
          const opts = createMemo(() => {
            if (++runs > 200) throw new Error("runaway");
            return { s: slow(), item: item() };
          });
          const key = createMemo(() => ({ hash: `${opts().s}:${opts().item}` }));
          peeks.push(key);
          return () => key().hash;
        };
        const view =
          mode === "direct"
            ? (f => () => [f])(row(() => p.rows?.[0]?.key))
            : mapArray(
                () => p.rows,
                r => row(() => r().key),
                { keyed: (r: { key: string }) => r.key }
              );
        createRenderEffect(
          () =>
            view()
              .map(f => f())
              .join(","),
          v => {
            screen = v;
          }
        );
        return d;
      });
      flush();
      await tick();
      res.A([{ key: "a" }]);
      await tick();
      expect(screen).toBe("A:a");
      const before = runs;
      setId("B");
      flush();
      await tick();
      if (mode === "other-source") {
        slowRes.B("B");
        await tick();
      }
      res.B([{ key: "b" }]);
      await tick();
      expect(screen).toBe("B:b");
      expect(runs - before).toBeLessThan(10);
      dispose();
    });
  }
});
