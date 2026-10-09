/**
 * #3949 — replacing an own getter with a plain data value wrote the FORCE
 * sentinel onto a node whose accessor flag had just been cleared. The hot
 * read then served that sentinel's backing argument, `undefined`, to tracked
 * readers. snapshot() and a node-less read already returned the data value.
 */
import {
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  snapshot
} from "../../src/index.js";

function withGetter(): { x: number } {
  return {
    get x() {
      return 1;
    }
  };
}

function trackX(store: { x?: number }): number[] {
  const seen: number[] = [];
  createRoot(() => {
    createRenderEffect(
      () => store.x,
      v => {
        seen.push(v as number);
      }
    );
  });
  flush();
  return seen;
}

describe("#3949 accessor key replaced by data", () => {
  test("reconcile of an own getter notifies the data value", () => {
    const [store, setStore] = createStore(withGetter());
    const seen = trackX(store);

    setStore(reconcile({ x: 2 }, null));
    flush();

    expect(seen).toEqual([1, 2]);
    expect(store.x).toBe(2);
    expect(snapshot(store).x).toBe(2);
  });

  test("defineProperty inside a setter draft replaces a getter with data", () => {
    const [store, setStore] = createStore(withGetter());
    const seen = trackX(store);

    setStore(s => {
      Object.defineProperty(s, "x", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: 2
      });
    });
    flush();

    expect(seen).toEqual([1, 2]);
    expect(store.x).toBe(2);
    expect(snapshot(store).x).toBe(2);
  });

  test("a setter that returns a replacement object replaces a getter with data", () => {
    const [store, setStore] = createStore(withGetter());
    const seen = trackX(store);

    setStore(() => ({ x: 2 }));
    flush();

    expect(seen).toEqual([1, 2]);
    expect(store.x).toBe(2);
    expect(snapshot(store).x).toBe(2);
  });

  test("a plain data key still notifies", () => {
    const [store, setStore] = createStore({ x: 1 });
    const seen = trackX(store);

    setStore(s => {
      s.x = 2;
    });
    flush();

    expect(seen).toEqual([1, 2]);
    expect(store.x).toBe(2);
    expect(snapshot(store).x).toBe(2);
  });

  test("getter to deleted still reads undefined for a tracked reader", () => {
    const [store, setStore] = createStore<{ x?: number }>(withGetter());
    const seen = trackX(store);

    setStore(s => {
      delete s.x;
    });
    flush();

    expect(seen).toEqual([1, undefined]);
    expect(store.x).toBeUndefined();
    expect(snapshot(store).x).toBeUndefined();
  });
});
