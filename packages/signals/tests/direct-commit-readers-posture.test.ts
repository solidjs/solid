/**
 * The promise-delivery readers — until(), resolve() (and awaitable refresh()'s
 * waiter; CONFIG_DIRECT_COMMIT) — by posture, over a frame HELD under an
 * action's optimism (#3482).
 *
 * The shape: an optimistic row on the store a live stream feeds, confirmed by
 * the server's echo. The server broadcasts before it answers the mutation, so
 * the confirming frame lands while the action is in flight and is staged under
 * its hold — the UI keeps showing the optimistic row until the action settles.
 *
 * Delivery is authoritative, not the transition's completion (Ryan's ruling on
 * #4267/#4263, superseding the #3490/#3492 posture split): a reader created
 * after that frame is held delivers the held landing — the truth has
 * answered — whatever its posture:
 *
 * - INSIDE the action, after a bare `yield` re-entered the transaction: the
 *   reader is the action's own and reads its own hold's frame.
 * - INSIDE the action from an `await` continuation with no bare `yield` first
 *   (#3482 as filed): the reader is mainline over a hold its action keeps
 *   open. It used to be born held (A29) and wait for the commit its own
 *   promise held open (a deadlock); it now delivers the landing.
 * - OUTSIDE the action: the same. The screen keeps the optimistic row until
 *   the action settles; the promise answers when the truth does.
 *
 * A mainline reader over a plain pending frame (no action open) still
 * delivers at its commit (`watch-error-outcomes.test.ts`).
 *
 * Reproduction and analysis by @brenelz (#3482); docs fixed in #3491.
 */
import { expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  resolve,
  until
} from "../src/index.js";

type Row = { id: string; status: "pending" | "confirmed" };
type Snapshot = { rows: Row[] };

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

// A manually pumped AsyncIterable — what a live() server-function stream
// materializes as on the client.
function stream<T>() {
  const buffered: IteratorResult<T>[] = [];
  let waiter: ((r: IteratorResult<T>) => void) | null = null;
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<T>>(res => {
          if (buffered.length) res(buffered.shift()!);
          else waiter = res;
        }),
      return: () => Promise.resolve({ done: true as const, value: undefined })
    })
  };
  return {
    iterable,
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

const CONFIRMED: Snapshot = { rows: [{ id: "res_1", status: "confirmed" }] };

/** Optimistic row + live feed, the action's body supplied by the test. */
function harness(body: (ctx: { store: Snapshot; mutation: Promise<Row> }) => AsyncGenerator) {
  const feed = stream<Snapshot>();
  let answer!: (row: Row) => void;
  const mutation = new Promise<Row>(res => (answer = res));
  const views: string[] = [];
  let run!: () => Promise<unknown>;
  let store!: Snapshot;

  createRoot(() => {
    const [s, setStore] = createOptimisticStore<Snapshot>(
      () => feed.iterable,
      { rows: [] },
      {
        key: "id"
      }
    );
    store = s;
    run = action(async function* () {
      setStore(d => {
        d.rows.push({ id: "temp", status: "pending" });
      });
      yield* body({ store: s, mutation });
    });
    createRenderEffect(
      () => s.rows.map(r => `${r.id}:${r.status}`).join(",") || "empty",
      v => {
        views.push(v);
      }
    );
  });

  return {
    feed,
    answer: () => answer({ id: "res_1", status: "confirmed" }),
    views,
    run,
    get store() {
      return store;
    }
  };
}

test("inside the action after a bare yield: until() sees the frame held under its own action", async () => {
  const h = harness(async function* ({ store, mutation }) {
    const saved = await mutation;
    yield; // re-enter the transaction — the documented form
    yield until(() => store.rows.some(r => r.id === saved.id), { timeout: 200 });
  });
  h.feed.push({ rows: [] });
  await settle();
  const done = h.run().then(
    () => "settled",
    e => e
  );
  await settle();
  h.feed.push(CONFIRMED); // broadcast first: held under the action
  await settle();
  expect(h.views.at(-1)).toBe("temp:pending");
  h.answer();
  await settle();
  expect(await done).toBe("settled");
  await settle();
  expect(h.views.at(-1)).toBe("res_1:confirmed");
});

test("inside the action WITHOUT the bare yield: until() delivers the held landing (#3482 as filed no longer deadlocks)", async () => {
  const h = harness(async function* ({ store, mutation }) {
    const saved = await mutation;
    // `until(...)` is evaluated in the await continuation, before this yield
    // re-enters — a mainline reader over a hold its action keeps open.
    yield until(() => store.rows.some(r => r.id === saved.id), { timeout: 100 });
  });
  h.feed.push({ rows: [] });
  await settle();
  const done = h.run().then(
    () => "settled",
    e => e
  );
  await settle();
  h.feed.push(CONFIRMED);
  await settle();
  h.answer();
  await settle();
  expect(await done).toBe("settled");
  await settle();
  expect(h.views.at(-1)).toBe("res_1:confirmed");
});

test("mainline, outside the action: resolve() and until() over an action's open hold deliver the held landing before the commit; the screen waits for it", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const h = harness(async function* ({ mutation }) {
    await mutation;
    yield;
    yield gate; // keep the hold open past the answer
  });
  h.feed.push({ rows: [] });
  await settle();
  const done = h.run().then(
    () => "settled",
    e => e
  );
  await settle();
  h.feed.push(CONFIRMED);
  await settle();
  expect(h.views.at(-1)).toBe("temp:pending");

  // Outside the action, after the frame is held: authoritative delivery —
  // the truth has answered, though the screen still shows the guess.
  let resolved: unknown = "pending";
  let acked: unknown = "pending";
  resolve(() => h.store.rows.map(r => r.id).join(",") || "empty").then(
    v => (resolved = v),
    e => (resolved = e)
  );
  until(() => h.store.rows.some(r => r.id === "res_1"), { timeout: 1000 }).then(
    v => (acked = v),
    e => (acked = e)
  );
  h.answer();
  await settle();
  expect(h.views.at(-1)).toBe("temp:pending");
  expect(resolved).toBe("res_1");
  expect(acked).toBe(true);

  release();
  await settle();
  expect(await done).toBe("settled");
  await settle();
  expect(h.views.at(-1)).toBe("res_1:confirmed");
});
