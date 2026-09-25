/**
 * solidjs/solid-router#619, #620 — an optimistic store whose source refetches
 * because of a write made OUTSIDE the action's transaction (a router action
 * calls `revalidate()` after an `await`, past the action's context).
 *
 * The store derives synchronously from an async memo, so the refetch is not a
 * declared flight of the store (`fam.ft` is null) and belongs to the outside
 * write's transaction. The action's transaction parked on it and nothing
 * re-entered it when the refetch landed: held writes (mapArray's index
 * signals) never committed (#619), and an unchanged truth never lifted the
 * overlay (#620).
 */
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

type Card = { id: string; order: number };
const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run({
  outside,
  fetchMs = 1,
  changes = true
}: {
  outside: boolean;
  fetchMs?: number;
  changes?: boolean;
}) {
  let db: Card[] = [
    { id: "a", order: 0 },
    { id: "b", order: 1 },
    { id: "c", order: 2 }
  ];
  const [version, setVersion] = createSignal(0);
  const mutate = async () => {
    await tick(5);
    if (changes)
      db = [
        { id: "a", order: 1 },
        { id: "b", order: 0 },
        { id: "c", order: 2 }
      ];
  };
  const frames: string[] = [];
  let swap!: () => Promise<void>;
  createRoot(() => {
    const data = createMemo(async () => {
      version();
      await tick(fetchMs);
      return db.map(c => ({ ...c }));
    });
    const [cards, setCards] = createOptimisticStore(() => data(), [] as Card[]);
    swap = action(function* () {
      setCards(list => {
        list[0].order = 1;
        list[1].order = 0;
      });
      if (outside)
        yield (async () => {
          await mutate();
          setVersion(v => v + 1);
        })();
      else {
        yield mutate();
        setVersion(v => v + 1);
      }
    });
    const rows = mapArray(
      () => [...cards].sort((x, y) => x.order - y.order),
      (r, i) => () => `${r.id}:${i()}`
    );
    createRenderEffect(
      () =>
        rows()
          .map(f => f())
          .join(" "),
      v => {
        frames.push(v);
      }
    );
  });
  flush();
  await tick(10 + fetchMs);
  flush();
  swap();
  flush();
  await tick(50 + fetchMs);
  flush();
  return frames;
}

describe("optimistic store refetched by a write outside the action (router#619)", () => {
  it("commits held index writes when the refetch is inside the action", async () => {
    expect(await run({ outside: false })).toEqual(["a:0 b:1 c:2", "b:1 a:0 c:2", "b:0 a:1 c:2"]);
  });

  it("commits held index writes when the refetch is outside the action", async () => {
    expect(await run({ outside: true })).toEqual(["a:0 b:1 c:2", "b:1 a:0 c:2", "b:0 a:1 c:2"]);
  });

  it("keeps the optimistic view until a slow outside refetch lands", async () => {
    expect(await run({ outside: true, fetchMs: 30 })).toEqual([
      "a:0 b:1 c:2",
      "b:1 a:0 c:2",
      "b:0 a:1 c:2"
    ]);
  });

  it("drops the overlay when the outside refetch returns unchanged truth (router#620)", async () => {
    expect(await run({ outside: true, changes: false })).toEqual([
      "a:0 b:1 c:2",
      "b:1 a:0 c:2",
      "a:0 b:1 c:2"
    ]);
  });
});
