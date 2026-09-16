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
 * Two postures for a reader created after that frame is held:
 *
 * - INSIDE the action, after a bare `yield` re-entered the transaction: the
 *   reader is the action's own. `recompute`'s DIRECT_COMMIT arm delivers its
 *   result on a microtask under the action's own hold — the predicate sees the
 *   held frame, the action settles, the commit reveals frame + overlay revert.
 *   This is the documented form (`action()`: code between an `await` and the
 *   next `yield` runs outside the transaction; the expression of
 *   `yield until(...)` is evaluated BEFORE that yield re-enters).
 *
 * - MAINLINE — outside the action, or inside it from an `await` continuation
 *   with no bare `yield` first: the reader is not the action's. It is born
 *   held (A29) and replays at the commit: it serves the COMMITTED view, never
 *   the foreign hold's unrevealed frame. From outside the action that is the
 *   only correct answer — `resolve()` is routinely called outside actions, and
 *   an in-flight action's speculative frame must not leak to it. From inside
 *   the action without the bare `yield` it is the deadlock #3482 reported:
 *   the commit the reader waits for is the settle its own promise holds open.
 *   Same mechanism, one posture — which is why an exemption for the
 *   direct-commit readers in `enterStagedRead` (proposed in #3482, declined in
 *   #3490) is wrong: it cannot tell the two apart and serves the leak to fix
 *   the deadlock.
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
  TimeoutError,
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

test("inside the action WITHOUT the bare yield: until() is mainline, born held, and times out (#3482 as filed)", async () => {
  const h = harness(async function* ({ store, mutation }) {
    const saved = await mutation;
    // `until(...)` is evaluated in the await continuation, before this yield
    // re-enters — a mainline reader over the action's own hold.
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
  await new Promise(r => setTimeout(r, 120));
  await settle();
  expect(await done).toBeInstanceOf(TimeoutError);
});

test("mainline, outside the action: resolve() and until() over a foreign hold serve the committed view, after the commit — never the held frame", async () => {
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

  // Outside the action, after the frame is held. A reader here is not the
  // action's: it must not see the unrevealed frame.
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
  expect(resolved).toBe("pending");
  expect(acked).toBe("pending");

  release();
  await settle();
  expect(await done).toBe("settled");
  await settle();
  expect(h.views.at(-1)).toBe("res_1:confirmed");
  expect(resolved).toBe("res_1");
  expect(acked).toBe(true);
});
