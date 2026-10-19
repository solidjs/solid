/**
 * #4111 — a user `equals` comparator that reads a pending async source.
 *
 * A memo returns an object whose getter reads an async memo the object owns;
 * the comparator reads that getter on the new object while its async memo is
 * still uninitialized, so the read throws NotReadyError. The comparator did not
 * show the values equal, so the value is a change: the reader that
 * dereferences the getter in its own tracked context suspends under its
 * Loading boundary and recovers when the async work lands. Before the fix the
 * memo stored the NotReadyError as its error, nothing tracked the inner memo,
 * and the UI stayed on the previous value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("equals reading a pending getter (#4111)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function setup(asyncOuter: boolean) {
    const log: unknown[] = [];
    const [n, setN] = createSignal(0);
    const [beat, setBeat] = createSignal(0);
    const resolvers: (() => void)[] = [];

    createRoot(() => {
      const obj = createMemo(
        () => {
          const v = n();
          const inner = createMemo(() => new Promise<number>(r => resolvers.push(() => r(v))));
          const o = {
            get value() {
              return inner();
            }
          };
          return asyncOuter && v !== 0 ? Promise.resolve().then(() => o) : o;
        },
        { equals: (a, b) => a.value === b.value }
      );
      const view = createLoadingBoundary(
        () => `Value: ${obj().value}`,
        () => "loading"
      );
      createRenderEffect(view, v => {
        log.push(v);
      });
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
    });
    return { log, setN, setBeat, resolvers };
  }

  for (const asyncOuter of [false, true])
    it(`${asyncOuter ? "async landing" : "sync recompute"}: the UI reaches the resolved value`, async () => {
      const { log, setN, setBeat, resolvers } = setup(asyncOuter);
      flush();
      resolvers.splice(0).forEach(r => r());
      await tick();
      flush();
      expect(log.at(-1)).toBe("Value: 0");

      setN(2);
      flush();
      await tick();
      flush();
      // Pending, not errored: the boundary keeps the previous frame.
      expect(log.at(-1)).toBe("Value: 0");
      expect(errorSpy).not.toHaveBeenCalled();

      resolvers.splice(0).forEach(r => r());
      await tick();
      flush();
      expect(log.at(-1)).toBe("Value: 2");

      // The scheduler is alive.
      setBeat(1);
      flush();
      expect(log.at(-1)).toBe("beat=1");
      expect(errorSpy).not.toHaveBeenCalled();
    });

  // Every comparator site takes the NotReady read as a change (`isSame`):
  // a user setter, the seam's net-to-committed check inside a transaction,
  // and repeated passes, none of which may throw it out of `flush()`.
  it("a user setter whose comparator reads a pending memo writes, not throws", async () => {
    let res!: (v: number) => void;
    const log: unknown[] = [];
    let set!: (v: { v: number }) => void;
    createRoot(() => {
      const gate = createMemo(() => new Promise<number>(r => (res = r)));
      const [s, setS] = createSignal(
        { v: 0 },
        {
          equals: (a, b) => {
            gate();
            return a.v === b.v;
          }
        }
      );
      set = setS;
      createRenderEffect(
        () => s().v,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    expect(() => {
      set({ v: 1 });
      flush();
    }).not.toThrow();
    res(1);
    await tick();
    flush();
    expect(log).toEqual([0, 1]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the seam's staged-equals-committed check in a transaction does not throw", async () => {
    const log: unknown[] = [];
    const [n, setN] = createSignal(0);
    const [beat, setBeat] = createSignal(0);
    const resolvers: (() => void)[] = [];
    createRoot(() => {
      const a = createMemo(async () => {
        const v = n();
        await new Promise<void>(r => resolvers.push(r));
        return v;
      });
      const gate = createMemo(() => new Promise<number>(() => {}));
      const m = createMemo(() => ({ v: n() }), {
        equals: (x, y) => {
          gate();
          return x.v === y.v;
        }
      });
      createRenderEffect(
        createLoadingBoundary(
          () => `${a()}-${m().v}`,
          () => "loading"
        ),
        v => {
          log.push(v);
        }
      );
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
    });
    flush();
    resolvers.splice(0).forEach(r => r());
    await tick();
    flush();
    expect(log.at(-1)).toBe("0-0");
    expect(() => {
      setN(1);
      flush();
      setN(2);
      flush();
    }).not.toThrow();
    resolvers.splice(0).forEach(r => r());
    await tick();
    expect(() => flush()).not.toThrow();
    expect(log.at(-1)).toBe("2-2");
    setBeat(1);
    flush();
    expect(log.at(-1)).toBe("beat=1");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a comparator that stays NotReady does not loop and the latest value shows", async () => {
    let runs = 0;
    const log: unknown[] = [];
    const [n, setN] = createSignal(0);
    createRoot(() => {
      const gate = createMemo(() => new Promise<number>(() => {}));
      const m = createMemo(
        () => {
          runs++;
          return { v: n() };
        },
        {
          equals: (x, y) => {
            gate();
            return x.v === y.v;
          }
        }
      );
      createRenderEffect(
        () => m().v,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    setN(1);
    flush();
    setN(2);
    flush();
    await tick();
    flush();
    expect(runs).toBeLessThan(10);
    expect(log.at(-1)).toBe(2);
  });

  it("once its source lands the comparator decides again", async () => {
    const log: unknown[] = [];
    const [n, setN] = createSignal(0);
    let gateRes!: (v: number) => void;
    createRoot(() => {
      const gate = createMemo(() => new Promise<number>(r => (gateRes = r)));
      const m = createMemo(() => ({ v: n() >> 1 }), {
        equals: (x, y) => {
          gate();
          return x.v === y.v;
        }
      });
      createRenderEffect(
        () => m(),
        v => {
          log.push(v.v);
        }
      );
    });
    flush();
    // NotReady: a change, so the (equal) value flows.
    setN(1);
    flush();
    gateRes(0);
    await tick();
    flush();
    // Ready: equal values are filtered again.
    setN(0);
    flush();
    expect(log).toEqual([0, 0]);
  });
});
