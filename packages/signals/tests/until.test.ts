/**
 * until(fn, options?) — the acknowledgment primitive for mutations confirmed
 * on a live data channel rather than by the mutation's own response.
 *
 * Contract under test:
 * - Resolves the first time the predicate settles TRUTHY, with that value.
 *   Falsy results and pending async reads both mean "not yet".
 * - Rejects on predicate error, async source rejection, timeout
 *   (TimeoutError), and abort (signal.reason).
 * - AUTHORITATIVE-VIEW reads — this is the read-semantics difference from
 *   resolve(), and it cuts both ways:
 *   - Optimistic OVERRIDES are invisible: the caller's own tentative writes
 *     can never satisfy the predicate (the self-satisfaction pin). Works on
 *     the single-primitive shape where the optimistic store IS the live-fed
 *     store.
 *   - Transition-STAGED data reads normally: uncommitted-but-real values —
 *     including truth landing INTO the open transaction (a refresh the
 *     action issued) — satisfy the predicate. Refusing them would deadlock
 *     the hold on data the hold itself keeps uncommitted.
 * - Delivery while held: the promise settles while the transaction it was
 *   yielded into is still open (the #2930 resolve() contract + direct value
 *   commit), so `yield until(...)` cannot deadlock the action holding it.
 */
import { expect, test, vi } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRoot,
  createSignal,
  flush,
  refresh,
  TimeoutError,
  until
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

test("resolves immediately with a truthy predicate's value", async () => {
  const [count] = createSignal(5);
  await expect(until(() => count() > 3 && count())).resolves.toBe(5);
});

test("waits through falsy evaluations and resolves when the condition flips", async () => {
  const [count, setCount] = createSignal(0);
  let settled = false;
  const p = until(() => count() >= 2 && count()).then(v => ((settled = true), v));
  flush();
  await tick();
  expect(settled).toBe(false);

  setCount(1); // still falsy — keeps waiting
  flush();
  await tick();
  expect(settled).toBe(false);

  setCount(2);
  flush();
  await expect(p).resolves.toBe(2);
});

test("waits through pending async and resolves when the source lands truthy", async () => {
  let resolveAsync!: (v: string) => void;
  const [user] = createSignal(() => new Promise<string>(r => (resolveAsync = r)));
  const p = until(() => user() === "ready");
  flush();
  await tick();
  resolveAsync("ready");
  await expect(p).resolves.toBe(true);
});

test("rejects when the predicate throws", async () => {
  const [count, setCount] = createSignal(0);
  const p = until(() => {
    if (count() > 0) throw new Error("boom");
    return false;
  });
  flush();
  await tick();
  setCount(1);
  flush();
  await expect(p).rejects.toThrow("boom");
});

test("rejects when an async source rejects", async () => {
  let rejectAsync!: (e: unknown) => void;
  const [user] = createSignal(() => new Promise<string>((_, rej) => (rejectAsync = rej)));
  const p = until(() => user() === "ready");
  flush();
  await tick();
  rejectAsync(new Error("network down"));
  await expect(p).rejects.toThrow("network down");
});

test("timeout rejects with TimeoutError and stops the subscription", async () => {
  vi.useFakeTimers();
  try {
    const [count, setCount] = createSignal(0);
    const p = until(() => count() > 0, { timeout: 50 });
    const outcome = p.then(
      () => "resolved",
      e => e
    );
    await vi.advanceTimersByTimeAsync(60);
    const e = await outcome;
    expect(e).toBeInstanceOf(TimeoutError);
    // A late flip must not matter — the root is disposed.
    setCount(1);
    flush();
    await vi.advanceTimersByTimeAsync(10);
  } finally {
    vi.useRealTimers();
  }
});

test("abort rejects with the signal's reason; pre-aborted rejects synchronously", async () => {
  const [count] = createSignal(0);
  const controller = new AbortController();
  const p = until(() => count() > 0, { signal: controller.signal });
  const outcome = p.then(
    () => "resolved",
    e => e
  );
  controller.abort(new Error("user cancelled"));
  expect(await outcome).toEqual(new Error("user cancelled"));

  const pre = new AbortController();
  pre.abort("already gone");
  await expect(until(() => true, { signal: pre.signal })).rejects.toBe("already gone");
});

test("dev guard: throws when called inside a reactive scope", () => {
  const [count] = createSignal(0);
  expect(() =>
    createRoot(() => {
      let err: unknown;
      createEffect(
        () => {
          try {
            void until(() => count() > 0);
          } catch (e) {
            err = e;
            throw e;
          }
        },
        () => {}
      );
      flush();
      if (err) throw err;
    })
  ).toThrow(/inside a reactive scope/);
});

/**
 * SELF-SATISFACTION PIN (signal form): an action's own optimistic write must
 * not satisfy its `until` predicate; the committed landing must. The overlay
 * holds until then — the view never reverts in between (no flicker).
 */
test("action + createOptimistic: own override cannot satisfy until; committed truth resolves it", async () => {
  const [src, setSrc] = createSignal("initial");
  let name!: () => string;
  const views: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [n, setN] = createOptimistic(() => src());
    name = n;
    createEffect(
      () => n(),
      v => {
        views.push(v);
      }
    );
    (globalThis as any).__setN = setN;
  });
  flush();
  expect(views).toEqual(["initial"]);

  const setN = (globalThis as any).__setN as (v: string) => void;
  const order: string[] = [];
  const save = action(async function* () {
    setN("saved"); // optimistic
    order.push("written");
    yield until(() => name() === "saved" && name());
    order.push("acked");
  });

  const done = save().then(() => order.push("settled"));
  flush();
  await tick();
  await tick();
  // The override is live (view shows it) but the predicate reads the authoritative view —
  // the action must still be holding.
  expect(views.at(-1)).toBe("saved");
  expect(order).toEqual(["written"]);

  // Independent truth lands (the "live channel" confirming the write).
  setSrc("saved");
  flush();
  await tick();
  flush();
  await tick();
  await done;
  expect(order).toEqual(["written", "acked", "settled"]);
  // No flicker (and no duplicate fire): the view moved once and A17 silence
  // held for ordinary subscribers while the authoritative reader was woken.
  expect(views).toEqual(["initial", "saved"]);
  expect(name()).toBe("saved");
  delete (globalThis as any).__setN;
  dispose();
});

/**
 * SELF-SATISFACTION PIN (store form, single-primitive shape): the optimistic
 * store IS the live-fed store — predicate reads the same proxy the optimistic
 * row was written to. Covers value nodes, presence nodes, array length, and
 * iteration (find), all of which must serve the authoritative (override-free) view.
 */
test("action + createOptimisticStore: until over the same store ignores the optimistic row, resolves on landing", async () => {
  const resolvers: ((items: { id: string; text: string }[]) => void)[] = [];
  let setCount!: (v: number) => void;
  let store!: { items: { id: string; text: string }[] };
  let setStore!: (fn: (s: { items: { id: string; text: string }[] }) => void) => void;
  const views: string[][] = [];
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const [count, _setCount] = createSignal(0);
    setCount = _setCount;
    const [s, _setS] = createOptimisticStore<{ items: { id: string; text: string }[] }>(
      async () => {
        count();
        const items = await new Promise<{ id: string; text: string }[]>(r => resolvers.push(r));
        return { items };
      },
      { items: [] }
    );
    store = s;
    setStore = _setS;
    createEffect(
      () => store.items.map(i => i.id),
      v => {
        views.push(v);
      }
    );
  });
  flush();
  await tick();
  resolvers[0]([{ id: "a", text: "A" }]);
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["a"]);

  const order: string[] = [];
  const send = action(async function* () {
    setStore(s => {
      s.items.push({ id: "m1", text: "hello" });
    });
    order.push("written");
    yield until(() => store.items.some(i => i.id === "m1"));
    order.push("acked");
  });

  const done = send().then(() => order.push("settled"));
  flush();
  await tick();
  await tick();
  // Optimistic row is visible to the app…
  expect(views.at(-1)).toEqual(["a", "m1"]);
  // …but the authoritative-view predicate has not fired.
  expect(order).toEqual(["written"]);

  // The live channel confirms: a refetch lands authoritative data containing
  // the row (same vector as a socket push feeding the derive).
  setCount(1);
  flush();
  await tick();
  resolvers[1]([
    { id: "a", text: "A" },
    { id: "m1", text: "hello" }
  ]);
  await tick();
  flush();
  await tick();
  flush();
  await done;
  expect(order).toEqual(["written", "acked", "settled"]);
  expect(store.items.map(i => i.id)).toEqual(["a", "m1"]);
  // No flicker: the row never disappeared between overlay and landing.
  for (let i = views.findIndex(v => v.includes("m1")); i < views.length; i++) {
    expect(views[i]).toContain("m1");
  }
  dispose();
});

/**
 * Committed membership: optimistic adds/deletes must be invisible to `in`,
 * Object.keys, and spread inside the predicate.
 */
test("authoritative view covers membership: in / Object.keys ignore optimistic structure", async () => {
  const [gate, setGate] = createSignal(false);
  let record!: Record<string, string>;
  let setRecord!: (fn: (s: Record<string, string>) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [s, set] = createOptimisticStore<Record<string, string>>({ a: "1" });
    record = s;
    setRecord = set;
  });
  flush();

  const observed: Array<{ has: boolean; keys: string[] }> = [];
  const run = action(async function* () {
    setRecord(s => {
      s.b = "2";
      delete s.a;
    });
    yield until(() => {
      observed.push({ has: "b" in record, keys: Object.keys(record) });
      return gate();
    });
  });
  const p = run();
  flush();
  await tick();
  // Mid-hold: the app view composes the optimistic structure…
  expect("b" in record).toBe(true);
  expect(Object.keys(record)).toEqual(["b"]);
  // …while the predicate saw committed membership only (overlay invisible).
  expect(observed[0]).toEqual({ has: false, keys: ["a"] });

  setGate(true);
  flush();
  await p;
  expect(observed.at(-1)).toEqual({ has: false, keys: ["a"] });
  flush(); // settle: unconfirmed optimistic structure reverts (flash semantics)
  expect(Object.keys(record)).toEqual(["a"]);
  dispose();
});

/**
 * STAGED-VISIBILITY PIN (the other half of the authoritative view): truth
 * that lands INTO the open transaction — here, the landing of a refresh()
 * the action itself issued — stages uncommitted and CANNOT commit until the
 * hold releases. The predicate must read it staged, and the resolution must
 * deliver while held (direct value commit), or the action deadlocks on its
 * own data plane.
 */
test("refresh()ed async source landing mid-hold satisfies until", async () => {
  const resolvers: ((v: number) => void)[] = [];
  let version!: () => number;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    version = createMemo(() => new Promise<number>(r => resolvers.push(r)));
  });
  flush();
  await tick();
  resolvers[0](0);
  await tick();
  flush();
  expect(version()).toBe(0);

  const order: string[] = [];
  const save = action(async function* () {
    refresh(version);
    order.push("refreshed");
    yield until(() => version() >= 1, { timeout: 500 });
    order.push("acked");
  });
  const p = save().then(
    () => order.push("settled"),
    e => order.push("rejected:" + ((e as any)?.name ?? e))
  );
  flush();
  await tick();
  expect(resolvers.length).toBe(2);
  resolvers[1](1); // lands into the HELD transition: staged, uncommitted
  await tick();
  flush();
  await tick();
  flush();
  await p;
  expect(order).toEqual(["refreshed", "acked", "settled"]);
  expect(version()).toBe(1);
  dispose();
});

/** Staged plain writes are equally visible: a transactional signal write the
 * action made is real data (it WILL commit with the action) — only the
 * optimistic overlay is carved out of the predicate's view. */
test("staged plain-signal write inside the action is visible to until", async () => {
  const [x, setX] = createSignal(0);
  const order: string[] = [];
  const run = action(async function* () {
    setX(5); // plain transactional write: stages, holds until commit
    order.push("written");
    yield until(() => x() === 5, { timeout: 500 });
    order.push("acked");
  });
  const p = run().then(
    () => order.push("settled"),
    e => order.push("rejected:" + ((e as any)?.name ?? e))
  );
  flush();
  await tick();
  flush();
  await tick();
  await p;
  expect(order).toEqual(["written", "acked", "settled"]);
  expect(x()).toBe(5);
});

/** Manually pumped AsyncIterable — the shape a live server source's stream
 * materializes as on the client (see server-functions live()). */
function liveChannel<T>() {
  let waiter: ((r: IteratorResult<T>) => void) | null = null;
  const buffered: IteratorResult<T>[] = [];
  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<T>>(res => {
            if (buffered.length) res(buffered.shift()!);
            else waiter = res;
          })
      })
    } as AsyncIterable<T>,
    push(value: T) {
      const r = { done: false as const, value };
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(r);
      } else buffered.push(r);
    }
  };
}

/**
 * LIVE-CHANNEL SHAPE (RFC 06's headline example): the optimistic store
 * derives from an async-iterable live source; the ack is the stream echoing
 * the row. Pins the full stack — iterable → memo → optimistic store →
 * authoritative-view predicate — not just promise-shaped landings.
 */
test("until over an iterable-fed optimistic store resolves on the stream echo", async () => {
  type Msg = { id: string; pending?: boolean };
  const chan = liveChannel<Msg[]>();
  let messages!: Msg[];
  let setMessages!: (fn: (s: Msg[]) => void) => void;
  const views: string[][] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const feed = createMemo(() => chan.iterable as unknown as Msg[]);
    const [s, set] = createOptimisticStore<Msg[]>(() => feed(), []);
    messages = s;
    setMessages = set;
    createEffect(
      () => messages.map(m => m.id),
      v => void views.push(v)
    );
  });
  flush();
  chan.push([{ id: "a" }]);
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["a"]);

  const order: string[] = [];
  const send = action(async function* () {
    setMessages(s => {
      s.push({ id: "m1", pending: true });
    });
    order.push("written");
    yield until(() => messages.some(m => m.id === "m1"));
    order.push("acked");
  });
  const done = send().then(() => order.push("settled"));
  flush();
  await tick();
  await tick();
  // Optimistic row visible to the app; invisible to the predicate.
  expect(views.at(-1)).toEqual(["a", "m1"]);
  expect(order).toEqual(["written"]);

  // The live source echoes the confirmed row.
  chan.push([{ id: "a" }, { id: "m1" }]);
  await tick();
  flush();
  await tick();
  flush();
  await done;
  expect(order).toEqual(["written", "acked", "settled"]);
  expect(messages.map(m => m.id)).toEqual(["a", "m1"]);
  // No flicker: once shown, the row never left the view.
  for (let i = views.findIndex(v => v.includes("m1")); i < views.length; i++) {
    expect(views[i]).toContain("m1");
  }
  dispose();
});

/**
 * MERGED-TRANSACTION PIN: two actions writing the same optimistic node
 * entangle into one joint transaction (shared root), each holding on its own
 * ack. One ack releases one hold — the joint transaction stays open (and
 * every override stands) until the other confirms. The merge machinery moves
 * queue stashes; until's delivery deliberately bypasses stashes — this pins
 * that a merge can neither strand nor prematurely release a hold.
 */
test("holds survive transaction merge: entangled actions release independently", async () => {
  const [src] = createSignal("initial");
  const [gateA, setGateA] = createSignal(false);
  const [gateB, setGateB] = createSignal(false);
  let n!: () => string;
  let setN!: (v: string) => void;
  const views: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [nn, sn] = createOptimistic(() => src());
    n = nn;
    setN = sn;
    createEffect(
      () => n(),
      v => void views.push(v)
    );
  });
  flush();

  const order: string[] = [];
  const a = action(async function* () {
    setN("A");
    yield until(() => gateA());
    order.push("A-acked");
  });
  const b = action(async function* () {
    setN("B");
    yield until(() => gateB());
    order.push("B-acked");
  });
  const pa = a().then(() => order.push("A-settled"));
  flush();
  const pb = b().then(() => order.push("B-settled"));
  flush();
  await tick();
  // Both writes hit one node: entangled, one joint transaction. Last write
  // is the visible override; neither hold has released.
  expect(views.at(-1)).toBe("B");
  expect(order).toEqual([]);

  setGateA(true);
  flush();
  await tick();
  await tick();
  // A's ack releases A's hold only. The joint transaction is still open
  // (B holds), so the optimistic view stands — no partial revert.
  expect(order).toContain("A-acked");
  expect(order).not.toContain("B-acked");
  expect(n()).toBe("B");

  setGateB(true);
  flush();
  await tick();
  await tick();
  await Promise.all([pa, pb]);
  flush();
  expect(order).toContain("B-acked");
  // Joint settlement: unconfirmed optimism reverts to committed truth for
  // BOTH writers at once (flash semantics — src never changed).
  expect(n()).toBe("initial");
  dispose();
});

/** Timeout inside an action: rejection throws back at the yield point and the
 * optimistic state reverts with the failed action. */
test("timeout inside an action rejects at the yield point and reverts optimism", async () => {
  vi.useFakeTimers();
  try {
    const [src] = createSignal("initial");
    let name!: () => string;
    let setName!: (v: string) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [n, setN] = createOptimistic(() => src());
      name = n;
      setName = setN;
    });
    flush();

    let caught: unknown;
    const save = action(async function* () {
      setName("saved");
      try {
        yield until(() => name() === "saved", { timeout: 50 });
      } catch (e) {
        caught = e;
        throw e;
      }
    });
    const p = save().catch(e => e);
    flush();
    await vi.advanceTimersByTimeAsync(60);
    const err = await p;
    expect(caught).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    flush();
    // Failed action: the optimistic override reverted to committed truth.
    expect(name()).toBe("initial");
    dispose();
  } finally {
    vi.useRealTimers();
  }
});
