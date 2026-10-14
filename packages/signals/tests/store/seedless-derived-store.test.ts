/**
 * #3194: the seedless derived form. `fn` takes no draft and every answer is
 * a complete value; the root starts as an empty record, a draft that is
 * never observable before the first landing (A25).
 */
import { describe, expect, it } from "vitest";
import {
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

describe("seedless derived stores", () => {
  it("sync: the first answer is the store", () => {
    const [n, setN] = createSignal(1);
    const seen: number[] = [];
    let store!: { a: number };
    createRoot(() => {
      store = createProjection(() => ({ a: n() }));
      createRenderEffect(
        () => store.a,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    setN(2);
    flush();
    expect(seen).toEqual([1, 2]);
  });

  it("async: unreadable until the first landing, then the landed record", async () => {
    let resolve!: (v: { a: number }) => void;
    let store!: { a: number };
    createRoot(() => {
      [store] = createStore(() => new Promise<{ a: number }>(r => (resolve = r)));
    });
    flush();
    expect(() => store.a).toThrow();
    expect(() => Object.keys(store)).toThrow();
    resolve({ a: 1 });
    await settle();
    expect(store.a).toBe(1);
    expect(Object.keys(store)).toEqual(["a"]);
  });

  it("async iterator: each yield is a complete snapshot", async () => {
    const gates: ((v: void) => void)[] = [];
    const gate = () => new Promise<void>(r => gates.push(r));
    let store!: { a: number; b?: number };
    createRoot(() => {
      store = createProjection(async function* () {
        await gate();
        yield { a: 1, b: 1 } as { a: number; b?: number };
        await gate();
        yield { a: 2 };
      });
    });
    flush();
    gates.shift()!();
    await settle();
    expect({ ...store }).toEqual({ a: 1, b: 1 });
    gates.shift()!();
    await settle();
    expect({ ...store }).toEqual({ a: 2 });
  });

  it("options reach through an undefined seed", async () => {
    let store!: { user: { email: string; n: number } };
    const [n, setN] = createSignal(1);
    createRoot(() => {
      store = createProjection(async () => ({ user: { email: "a@x", n: n() } }), undefined, {
        key: "email"
      });
    });
    flush();
    await settle();
    const row = store.user;
    setN(2);
    flush();
    await settle();
    expect(store.user).toBe(row);
    expect(store.user.n).toBe(2);
  });

  it("a setter before the first landing drafts the empty record, and the landing replaces it", async () => {
    let resolve!: (v: { a: number }) => void;
    let store!: { a: number; x?: number };
    let set!: (f: (d: { a: number; x?: number }) => void) => void;
    const drafts: string[] = [];
    createRoot(() => {
      [store, set] = createStore(() => new Promise<{ a: number; x?: number }>(r => (resolve = r)));
    });
    flush();
    set(d => {
      drafts.push(JSON.stringify(d));
      d.x = 5;
    });
    flush();
    resolve({ a: 1 });
    await settle();
    expect(drafts).toEqual(["{}"]);
    expect({ ...store }).toEqual({ a: 1 });
  });

  it("optimistic: seedless form lands like the seeded one", async () => {
    let resolve!: (v: { a: number }) => void;
    let store!: { a: number };
    createRoot(() => {
      [store] = createOptimisticStore(() => new Promise<{ a: number }>(r => (resolve = r)));
    });
    flush();
    expect(() => store.a).toThrow();
    resolve({ a: 1 });
    await settle();
    expect(store.a).toBe(1);
  });
});
