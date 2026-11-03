/**
 * #4671 — a change to ONLY a key's enumerability changes the store's
 * enumerable key set, so key-set readers (`Object.keys`, `for…in`, spread)
 * re-run at the flush, in both directions (CS-R14: key-set membership;
 * CS-R51: descriptors agree with reads after flush, non-enumerable stays
 * non-enumerable; F-10: the write is visible at flush to every channel —
 * the tracked reader as well as the untracked one).
 *
 * The key's value did not change, so a reader of the value alone does not
 * re-run (CS-R10: per-property tracking, a same-value write does not
 * re-trigger; CS-R14: the key-set node is distinct from property nodes).
 */
import { describe, expect, it } from "vitest";
import { createRenderEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";

const payload = { value: 1 };
const row = (visible: boolean) =>
  Object.defineProperty({ payload }, "payload", {
    value: payload,
    enumerable: visible,
    writable: true,
    configurable: true
  });

function setup(initial: boolean) {
  const [r, setR] = createStore<any>(row(initial));
  const log: string[][] = [];
  let valueRuns = 0;
  createRoot(() => {
    createRenderEffect(
      () => Object.keys(r),
      v => {
        log.push(v);
      }
    );
    createRenderEffect(
      () => r.payload,
      () => {
        valueRuns++;
      }
    );
  });
  flush();
  return { r, setR, log, valueRuns: () => valueRuns };
}

describe("#4671 enumerability flip notifies key-set readers", () => {
  it("reconcile visible -> hidden re-runs Object.keys; value reader does not re-run", () => {
    const { r, setR, log, valueRuns } = setup(true);
    expect(log).toEqual([["payload"]]);
    expect(valueRuns()).toBe(1);
    setR(reconcile(row(false), () => undefined) as any);
    flush();
    expect(Object.keys(r)).toEqual([]);
    expect(log).toEqual([["payload"], []]);
    expect(valueRuns()).toBe(1);
    expect(r.payload).toBe(r.payload);
    expect(r.payload.value).toBe(1);
  });

  it("reconcile hidden -> visible re-runs Object.keys; value reader does not re-run", () => {
    const { r, setR, log, valueRuns } = setup(false);
    expect(log).toEqual([[]]);
    setR(reconcile(row(true), () => undefined) as any);
    flush();
    expect(Object.keys(r)).toEqual(["payload"]);
    expect(log).toEqual([[], ["payload"]]);
    expect(valueRuns()).toBe(1);
  });

  it("round trip hidden -> visible -> hidden", () => {
    const { setR, log } = setup(false);
    setR(reconcile(row(true), () => undefined) as any);
    flush();
    setR(reconcile(row(false), () => undefined) as any);
    flush();
    expect(log).toEqual([[], ["payload"], []]);
  });

  it("for…in and spread readers re-run", () => {
    const [r, setR] = createStore<any>(row(true));
    const forIn: string[][] = [];
    const spread: string[][] = [];
    createRoot(() => {
      createRenderEffect(
        () => {
          const ks: string[] = [];
          for (const k in r) ks.push(k);
          return ks;
        },
        v => {
          forIn.push(v);
        }
      );
      createRenderEffect(
        () => Object.keys({ ...r }),
        v => {
          spread.push(v);
        }
      );
    });
    flush();
    setR(reconcile(row(false), () => undefined) as any);
    flush();
    setR(reconcile(row(true), () => undefined) as any);
    flush();
    expect(forIn).toEqual([["payload"], [], ["payload"]]);
    expect(spread).toEqual([["payload"], [], ["payload"]]);
  });

  for (const order of ["keys-first", "value-first"] as const) {
    it(`one computation reading keys and value (${order}) sees the new key set`, () => {
      const [r, setR] = createStore<any>(row(true));
      const log: [string[], number][] = [];
      createRoot(() =>
        createRenderEffect(
          () => {
            if (order === "keys-first") {
              const ks = Object.keys(r);
              return [ks, r.payload.value] as [string[], number];
            }
            const v = r.payload.value;
            return [Object.keys(r), v] as [string[], number];
          },
          v => {
            log.push(v);
          }
        )
      );
      flush();
      setR(reconcile(row(false), () => undefined) as any);
      flush();
      setR(reconcile(row(true), () => undefined) as any);
      flush();
      expect(log).toEqual([
        [["payload"], 1],
        [[], 1],
        [["payload"], 1]
      ]);
    });
  }

  it("nested object: enumerability flip on a child notifies the child's key-set readers only", () => {
    const shape = (visible: boolean) => ({ id: 1, child: row(visible) });
    const [r, setR] = createStore<any>(shape(true));
    const childKeys: string[][] = [];
    let rootKeyRuns = 0;
    let valueRuns = 0;
    createRoot(() => {
      createRenderEffect(
        () => Object.keys(r.child),
        v => {
          childKeys.push(v);
        }
      );
      createRenderEffect(
        () => Object.keys(r),
        () => {
          rootKeyRuns++;
        }
      );
      createRenderEffect(
        () => r.child.payload,
        () => {
          valueRuns++;
        }
      );
    });
    flush();
    setR(reconcile(shape(false), "id") as any);
    flush();
    expect(Object.keys(r.child)).toEqual([]);
    setR(reconcile(shape(true), "id") as any);
    flush();
    expect(childKeys).toEqual([["payload"], [], ["payload"]]);
    expect(rootKeyRuns).toBe(1);
    expect(valueRuns).toBe(1);
  });

  it("setter defineProperty flipping enumerability re-runs key-set readers", () => {
    const [r, setR] = createStore<any>({ a: 1, b: 2 });
    const log: string[][] = [];
    let valueRuns = 0;
    createRoot(() => {
      createRenderEffect(
        () => Object.keys(r),
        v => {
          log.push(v);
        }
      );
      createRenderEffect(
        () => r.a,
        () => {
          valueRuns++;
        }
      );
    });
    flush();
    setR((s: any) => {
      Object.defineProperty(s, "a", {
        value: 1,
        enumerable: false,
        writable: true,
        configurable: true
      });
    });
    flush();
    expect(Object.keys(r)).toEqual(["b"]);
    setR((s: any) => {
      Object.defineProperty(s, "a", {
        value: 1,
        enumerable: true,
        writable: true,
        configurable: true
      });
    });
    flush();
    expect(Object.keys(r)).toEqual(["a", "b"]);
    expect(log).toEqual([["a", "b"], ["b"], ["a", "b"]]);
    expect(valueRuns).toBe(1);
  });
  it("wide store (overlay staging): setter defineProperty flip re-runs key-set readers", () => {
    const init: any = {};
    for (let i = 0; i < 64; i++) init["k" + i] = i;
    const [r, setR] = createStore<any>(init);
    const lens: number[] = [];
    let valueRuns = 0;
    createRoot(() => {
      createRenderEffect(
        () => Object.keys(r).length,
        v => {
          lens.push(v);
        }
      );
      createRenderEffect(
        () => r.k0,
        () => {
          valueRuns++;
        }
      );
    });
    flush();
    const flip = (enumerable: boolean) =>
      setR((s: any) => {
        Object.defineProperty(s, "k0", {
          value: 0,
          enumerable,
          writable: true,
          configurable: true
        });
      });
    flip(false);
    flush();
    expect(Object.keys(r).length).toBe(63);
    flip(true);
    flush();
    expect(Object.keys(r).length).toBe(64);
    expect(lens).toEqual([64, 63, 64]);
    expect(valueRuns).toBe(1);
  });
});
