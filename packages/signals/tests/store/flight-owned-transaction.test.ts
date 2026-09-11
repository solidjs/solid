/**
 * #3146 — the optimistic store's truth-flight OWNS its transaction.
 *
 * Before the fix, the flight had no transaction of its own: the ask's
 * pre-throw created (or joined) one, but ownership was never recorded — the
 * #2951 refetch-hold worked only when a tracked observer happened to
 * register an async reporter (keeping the ask transaction alive) and the
 * firewall happened to carry the right `_transition` stamp. With ownership
 * declared on the family, the hold is structural: the flight's transaction
 * lives exactly as long as the question is unanswered, observed or not, and
 * bare optimistic writes route into it by declaration.
 */
import { expect, test } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createOptimisticStore,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending
} from "../../src/index.js";
import type { Store } from "../../src/store.js";

const tick = () => new Promise(r => setTimeout(r, 0));

test("#3146: a bare write during an in-flight refetch holds without any tracked observer", async () => {
  const resolvers: ((items: string[]) => void)[] = [];
  let setCount!: (v: number) => void;
  let setS!: (fn: (s: { items: string[] }) => void) => void;
  let store!: Store<{ items: string[] }>;
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const [count, _setCount] = createSignal(0);
    setCount = _setCount;
    [store, setS] = createOptimisticStore<{ items: string[] }>(
      async () => {
        count();
        const items = await new Promise<string[]>(r => resolvers.push(r));
        return { items };
      },
      { items: [] }
    );
  });

  // Untracked pull starts the first flight — no effect ever observes the
  // store. The §6c gate makes the uninitialized derive unobservable, so the
  // kick-off read throws NotReady; only the pull matters here.
  try {
    store.items;
  } catch {
    /* uninitialized async derive */
  }
  flush();
  await tick();
  resolvers[0](["A"]);
  await tick();
  flush();
  expect(store.items.slice()).toEqual(["A"]);

  // Refetch starts with NOTHING tracking the store (the untracked read pulls
  // the dirty firewall).
  setCount(1);
  flush();
  expect(store.items.slice()).toEqual(["A"]);
  await tick();

  // Bare optimistic write during the in-flight truth: it must ride the
  // flight's own transaction and survive plain flush ends...
  setS(d => {
    d.items.push("U*");
  });
  flush();
  await tick();
  expect(store.items.slice()).toEqual(["A", "U*"]);
  flush();
  expect(store.items.slice()).toEqual(["A", "U*"]);

  // ...until the truth lands and supersedes it atomically.
  resolvers[1](["A", "U"]);
  await tick();
  flush();
  await tick();
  flush();
  expect(store.items.slice()).toEqual(["A", "U"]);
  dispose();
  flush();
});

test("#3146: per-yield landings still reveal on arrival under the flight-owned transaction", async () => {
  let resolveGate1!: () => void;
  const gate1 = new Promise<void>(r => (resolveGate1 = r));
  let resolveGate2!: () => void;
  const gate2 = new Promise<void>(r => (resolveGate2 = r));

  const views: string[][] = [];
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const [store] = createOptimisticStore<{ items: string[] }>(
      async function* () {
        yield { items: ["one"] };
        await gate1;
        yield { items: ["one", "two"] };
        await gate2;
        yield { items: ["one", "two", "three"] };
      },
      { items: [] }
    );
    createEffect(
      () => store.items.slice(),
      v => {
        views.push(v);
      }
    );
  });

  flush();
  await tick();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["one"]);

  // Each arrival reveals on its own schedule (A18(1)) — the owned transaction
  // renews per yield instead of batching the stream to flight end.
  resolveGate1();
  await tick();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["one", "two"]);

  resolveGate2();
  await tick();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["one", "two", "three"]);
  dispose();
  flush();
});

// The FIRST flight is the carve-out: nothing has committed yet, so there is
// no truth to keep on screen and no optimistic state to protect. Declaring
// the owned transaction for the uninitialized ask held every
// transition-riding consumer — render()'s scheduled root insert included —
// until the fetch landed: the page stayed blank and the Loading boundary's
// fallback never showed, while createStore(fn, seed) and
// createOptimistic(fn, seed) in the same spot showed it. A first flight
// declares nothing, like the loading window (#2933); refetch flights
// (initialized) declare exactly as the tests above pin.
type Resolver = (items: string[]) => void;

function boundaryHarness(make: (dep: () => number, resolvers: Resolver[]) => { items: string[] }) {
  const resolvers: Resolver[] = [];
  let setDep!: (v: number) => void;
  let result: unknown = "never-ran";
  let store!: { items: string[] };
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [dep, _setDep] = createSignal(0);
    setDep = _setDep;
    store = make(dep, resolvers);
    const boundary = createLoadingBoundary(
      () => store.items.join(","),
      () => "loading"
    );
    // A USER effect, like render()'s scheduled root insert: its apply is
    // stashed by an open transition until that transition settles.
    createEffect(
      () => boundary(),
      v => {
        result = v;
      }
    );
  });
  return {
    resolvers,
    setDep,
    get result() {
      return result;
    },
    get store() {
      return store;
    },
    dispose
  };
}

test("#3146 carve-out: the first flight shows the boundary fallback; the refetch keeps content", async () => {
  const h = boundaryHarness((dep, resolvers) => {
    const [store] = createOptimisticStore<{ items: string[] }>(
      async () => {
        dep();
        const items = await new Promise<string[]>(r => resolvers.push(r));
        return { items };
      },
      { items: [] }
    );
    return store;
  });
  flush();
  // The boundary's effect must APPLY on the initial flush (not be stashed
  // by a flight transaction) and show the fallback.
  expect(h.result).toBe("loading");

  h.resolvers[0](["A"]);
  await tick();
  flush();
  expect(h.result).toBe("A");

  // Refetch: stale-while-revalidate — content stays, isPending flips.
  h.setDep(1);
  flush();
  await tick();
  expect(h.result).toBe("A");
  expect(isPending(() => h.store.items.length)).toBe(true);

  h.resolvers[1](["A", "B"]);
  await tick();
  flush();
  await tick();
  flush();
  expect(h.result).toBe("A,B");
  expect(isPending(() => h.store.items.length)).toBe(false);
  h.dispose();
  flush();
});

test("#3146 carve-out control: createStore(fn, seed) first flight shows the same fallback", async () => {
  const h = boundaryHarness((dep, resolvers) => {
    const [store] = createStore<{ items: string[] }>(
      async () => {
        dep();
        const items = await new Promise<string[]>(r => resolvers.push(r));
        return { items };
      },
      { items: [] }
    );
    return store;
  });
  flush();
  expect(h.result).toBe("loading");
  h.resolvers[0](["A"]);
  await tick();
  flush();
  expect(h.result).toBe("A");
  h.dispose();
  flush();
});
