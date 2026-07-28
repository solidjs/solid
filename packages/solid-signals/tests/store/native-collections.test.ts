import { describe, expect, test } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";

// #2952 — native code brand-checks internal slots and throws when invoked
// with a store proxy as `this`, so platform objects (Map, Set, Date, ...)
// can't honestly be stores. isWrappable now excludes them structurally (tag
// check): they get the markRaw-children contract automatically — served raw,
// mutations land raw, and the property HOLDING them still tracks, so
// reassignment notifies. User class instances keep wrapping (getters and
// draft methods stay reactive).
describe("platform objects in stores (#2952)", () => {
  test("Map: reads work — methods, internal-slot accessors, iteration", () => {
    const [store] = createStore({ map: new Map<string, number>([["k", 1]]) });
    expect(store.map.get("k")).toBe(1);
    expect(store.map.has("k")).toBe(true);
    expect(store.map.size).toBe(1);
    expect([...store.map.keys()]).toEqual(["k"]);
  });

  test("Set: reads work — methods, internal-slot accessors, iteration", () => {
    const [store] = createStore({ set: new Set<number>([1, 2]) });
    expect(store.set.has(2)).toBe(true);
    expect(store.set.size).toBe(2);
    expect([...store.set]).toEqual([1, 2]);
  });

  test("platform objects are served raw, not proxied", () => {
    const map = new Map([["k", 1]]);
    const date = new Date(2026, 0, 15);
    const [store] = createStore({ map, date });
    expect(store.map).toBe(map);
    expect(store.date).toBe(date);
  });

  test("Map/Set: draft methods mutate the raw collection without throwing", () => {
    const [store, setStore] = createStore({
      map: new Map<string, number>([["k", 1]]),
      set: new Set<number>([1, 2])
    });

    setStore(s => {
      s.map.set("k2", 2);
      s.map.delete("k");
      s.set.add(3);
    });

    expect(store.map.get("k2")).toBe(2);
    expect(store.map.has("k")).toBe(false);
    expect(store.map.size).toBe(1);
    expect(store.set.has(3)).toBe(true);
    expect(store.set.size).toBe(3);
  });

  test("Date: internal-slot methods work on read and draft paths", () => {
    const [store, setStore] = createStore({ date: new Date(2026, 0, 15) });
    expect(store.date.getFullYear()).toBe(2026);
    setStore(s => {
      s.date.setFullYear(2030);
    });
    expect(store.date.getFullYear()).toBe(2030);
  });

  test("the property holding a platform object tracks: reassignment notifies", () => {
    const [store, setStore] = createStore({ map: new Map([["k", 1]]) });

    let size: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.map.size,
        v => {
          size = v;
        }
      );
    });
    flush();
    expect(size).toBe(1);

    setStore(s => {
      s.map = new Map([
        ["k", 1],
        ["k2", 2]
      ]);
    });
    flush();
    expect(size).toBe(2);
  });

  test("subclassed platform objects stay raw (tag is inherited)", () => {
    class MyMap extends Map<string, number> {}
    const mine = new MyMap([["k", 1]]);
    const [store, setStore] = createStore({ map: mine });
    expect(store.map).toBe(mine);
    expect(store.map.size).toBe(1);
    setStore(s => {
      s.map.set("k2", 2);
    });
    expect(store.map.size).toBe(2);
  });

  test("user class instances still wrap: getters track on the same store where map.size works", () => {
    class Thing {
      n = 1;
      map = new Map<string, number>([["k", 1]]);
      get doubled() {
        return this.n * 2;
      }
    }
    const [store, setStore] = createStore(new Thing());

    expect(store.map.size).toBe(1); // raw platform object, no throw

    let seen: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.doubled,
        v => {
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe(2);

    setStore(s => {
      s.n = 5;
    });
    flush();
    // User getter kept the proxy receiver: it tracked `n` and re-ran.
    expect(seen).toBe(10);
  });

  test("user-class methods on the draft keep the proxy `this` (reactive writes)", () => {
    class Counter {
      n = 1;
      increment() {
        this.n++;
      }
    }
    const [store, setStore] = createStore({ c: new Counter() });

    let seen: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.c.n,
        v => {
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe(1);

    setStore(s => {
      s.c.increment(); // must go through the traps, not the raw
    });
    flush();
    expect(seen).toBe(2);
  });

  test("null-prototype objects still wrap", () => {
    const bare = Object.create(null) as { n?: number };
    bare.n = 1;
    const [store, setStore] = createStore({ bare });

    let seen: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.bare.n,
        v => {
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe(1);
    setStore(s => {
      s.bare.n = 2;
    });
    flush();
    expect(seen).toBe(2);
  });
});
