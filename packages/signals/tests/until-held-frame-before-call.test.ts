/**
 * until() created AFTER its confirming frame was staged (#3482).
 *
 * The single-primitive shape the until() docstring recommends: an optimistic
 * row on the store a live stream feeds, confirmed by the server's echo. When
 * the server broadcasts to subscribers BEFORE it answers the mutation, the
 * confirming frame lands while the action is still awaiting the answer and is
 * held under the action's optimism. The action then reaches `yield until(...)`
 * from mainline (after its await).
 *
 * #3451 made mainline creation under a hold born held (A29). A born-held
 * effect skips its synchronous first run and is replayed at the commit — but
 * the commit IS the action's settle, which the until() promise is holding
 * open. Deadlock: with a timeout, TimeoutError; without one, forever.
 *
 * Ruling: a CONFIG_DIRECT_COMMIT reader (resolve / until / awaitable
 * refresh's waiter) is the tunnel through a hold by contract and applies on
 * its own microtask, so `enterStagedRead` neither enters it nor bears it held
 * — the same exemption verdict pulls already have. The predicate sees the
 * held frame, the action settles, the commit reveals frame + overlay revert.
 *
 * Reproduction and analysis by @brenelz (#3482). Regression from d80cd1f6.
 */
import { expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
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

/** The optimistic-row + socket-echo shape; `frameFirst` picks the ordering. */
async function reserveScenario(frameFirst: boolean) {
  const feed = stream<Snapshot>();
  let answer!: (row: Row) => void;
  const mutation = new Promise<Row>(res => (answer = res));
  const views: string[] = [];
  let reserve!: () => Promise<unknown>;

  createRoot(() => {
    const [store, setStore] = createOptimisticStore<Snapshot>(
      () => feed.iterable,
      { rows: [] },
      { key: "id" }
    );
    reserve = action(async function* () {
      setStore(d => {
        d.rows.push({ id: "temp", status: "pending" });
      });
      const saved = await mutation;
      yield until(() => store.rows.some(r => r.id === saved.id), { timeout: 200 });
    });
    createRenderEffect(
      () => store.rows.map(r => `${r.id}:${r.status}`).join(",") || "empty",
      v => {
        views.push(v);
      }
    );
  });

  feed.push({ rows: [] });
  await settle();
  expect(views.at(-1)).toBe("empty");

  const done = reserve().then(
    () => "settled",
    e => e
  );
  await settle();
  expect(views.at(-1)).toBe("temp:pending");

  const confirmed: Snapshot = { rows: [{ id: "res_1", status: "confirmed" }] };
  if (frameFirst) {
    // Server mutates and broadcasts first — the frame lands while the action
    // is still awaiting the mutation's answer, and is held under its optimism.
    feed.push(confirmed);
    await settle();
    expect(views.at(-1)).toBe("temp:pending");
    // Then it answers, and the action reaches its until().
    answer({ id: "res_1", status: "confirmed" });
  } else {
    // Control: the answer arrives first, until() subscribes, then the frame.
    answer({ id: "res_1", status: "confirmed" });
    await settle();
    expect(views.at(-1)).toBe("temp:pending");
    feed.push(confirmed);
  }
  await settle();

  const outcome = await done;
  expect(outcome).not.toBeInstanceOf(TimeoutError);
  expect(outcome).toBe("settled");
  await settle();
  expect(views.at(-1)).toBe("res_1:confirmed");
}

test("until() sees a confirming frame that landed on the held store before until() was called", async () => {
  await reserveScenario(true);
});

test("control: until() subscribed before the confirming frame lands (unchanged)", async () => {
  await reserveScenario(false);
});
