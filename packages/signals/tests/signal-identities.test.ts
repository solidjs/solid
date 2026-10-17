// Plain-signal identities (deferred hydration's dependency edges). While on,
// a plain signal created under an id-bearing owner is named `<id>~<n>`, n
// counting the plain signals created under the nearest id-bearing owner;
// the count restarts when the owner re-runs, as child ids do. A plain store
// root is named on the same count, and every write to the store goes by its
// root's name. The pre-write hook receives the named node (or the store
// proxy whose setter runs, then the store's property nodes as it
// notifies), and the dev read watch sees it on every read.
import { afterEach, describe, expect, test } from "vitest";
import { setReadWatch, setSignalIdentities, setWriteHook, signalName } from "../src/core/index.js";
import {
  createMemo,
  createOptimisticStore,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  flush,
  storeName
} from "../src/index.js";

afterEach(() => {
  setWriteHook(null);
  setReadWatch(null);
  setSignalIdentities(false);
});

function hookedWrites() {
  const writes: (string | undefined)[] = [];
  setWriteHook(node => writes.push(signalName(node)));
  return writes;
}
/** Every write-hook call's name, a store's included (deduped in order). */
function hookedStoreWrites() {
  const writes: (string | undefined)[] = [];
  setWriteHook(node => {
    const sid = signalName(node) ?? storeName(node);
    if (writes[writes.length - 1] !== sid) writes.push(sid);
  });
  return writes;
}

describe("plain-signal identities", () => {
  test("named per id-bearing owner, in creation order; the hook receives the named node", () => {
    setSignalIdentities(true);
    const writes = hookedWrites();
    const [setA, setB, setD, setS] = createRoot(
      () =>
        [
          createSignal(0)[1],
          createSignal(0)[1],
          createSignal(() => 1)[1],
          createStore({ n: 0 })[1]
        ] as const,
      { id: "r" }
    );
    setA(1);
    setB(1);
    setD(2);
    // The derived signal carries no name; the store is `r~2` (the hook gets
    // its proxy, then its property node: `storeName` names both).
    expect(writes).toEqual(["r~0", "r~1", undefined]);
    const stores = hookedStoreWrites();
    setS(s => void (s.n = 1));
    expect(stores).toEqual(["r~2"]);
  });

  test("a store goes by its root's name, from its root or any proxy nested in it", () => {
    setSignalIdentities(true);
    const [store, setStore, before, after] = createRoot(
      () => {
        const before = createSignal(0)[1];
        const [store, setStore] = createStore({ user: { name: "a" }, tags: ["x"] });
        const after = createSignal(0)[1];
        return [store, setStore, before, after] as const;
      },
      { id: "s" }
    );
    expect(storeName(store)).toBe("s~1");
    expect(storeName(store.user)).toBe("s~1");
    expect(storeName(store.tags)).toBe("s~1");
    const writes = hookedStoreWrites();
    before(1);
    setStore(s => void (s.user.name = "b"));
    after(1);
    expect(writes).toEqual(["s~0", "s~1", "s~2"]);
  });

  test("stores it cannot place have no name", () => {
    setSignalIdentities(true);
    const shared = { n: 0 };
    const [outside] = createStore({ n: 0 });
    const r = createRoot(
      () => {
        const [twice1] = createStore(shared);
        const [twice2] = createStore(shared);
        const proj = createProjection<{ v: number }>(() => {}, { v: 0 });
        const [opt] = createOptimisticStore({ n: 0 });
        const [plain] = createStore({ n: 0 });
        return { twice1, twice2, proj, opt, plain };
      },
      { id: "u" }
    );
    // Created outside any owner; one object made into two stores (one target
    // under two names); a projection; an optimistic store.
    expect(storeName(outside)).toBeUndefined();
    expect(storeName(r.twice1)).toBeUndefined();
    expect(storeName(r.twice2)).toBeUndefined();
    expect(storeName(r.proj)).toBeUndefined();
    expect(storeName(r.opt)).toBeUndefined();
    // The count still advanced for the two createStore calls.
    expect(storeName(r.plain)).toBe("u~2");
  });

  test("the count restarts when the owner re-runs", () => {
    setSignalIdentities(true);
    const writes = hookedWrites();
    let set: ((v: number) => void) | undefined;
    const [n, setN] = createSignal(0);
    createRoot(
      () => {
        createMemo(() => {
          n();
          [, set] = createSignal(0);
        });
      },
      { id: "m" }
    );
    flush();
    set!(1);
    setN(1);
    flush();
    set!(2);
    // The signal the second pass made has the first one's name.
    const named = writes.filter(w => w !== undefined);
    expect(named.length).toBe(2);
    expect(named[0]).toBe(named[1]);
  });

  test("off: no names; signals outside an id-bearing owner are never named", () => {
    const writes = hookedWrites();
    const set = createRoot(() => createSignal(0)[1], { id: "off" });
    set(1);
    setSignalIdentities(true);
    const [, outside] = createSignal(0);
    outside(1);
    expect(writes).toEqual([undefined, undefined]);
  });

  test("dev: the read watch sees named reads", () => {
    setSignalIdentities(true);
    const reads: string[] = [];
    createRoot(
      () => {
        const [a] = createSignal(0);
        setReadWatch(node => {
          const sid = signalName(node);
          if (sid !== undefined) reads.push(sid);
        });
        a();
        setReadWatch(null);
        a();
      },
      { id: "w" }
    );
    expect(reads).toEqual(["w~0"]);
  });
});
