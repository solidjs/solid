// solidjs/solid-router#619, #620: an optimistic store refetched by a write outside the action.
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

  it("keeps the refetch hold when an unrelated pending action stamped the store first", async () => {
    let db: Card[] = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 }
    ];
    const [version, setVersion] = createSignal(0);
    const frames: string[] = [];
    let stuck!: () => Promise<void>;
    let swap!: () => Promise<void>;
    createRoot(() => {
      const data = createMemo(async () => {
        version();
        await tick(30);
        return db.map(c => ({ ...c }));
      });
      const [cards, setCards] = createOptimisticStore(() => data(), [] as Card[]);
      stuck = action(function* () {
        setCards(list => {
          list[2].order = 5;
        });
        yield new Promise<void>(() => {});
      });
      swap = action(function* () {
        setCards(list => {
          list[0].order = 1;
          list[1].order = 0;
        });
        yield tick(5);
        db = [
          { id: "a", order: 1 },
          { id: "b", order: 0 },
          { id: "c", order: 2 }
        ];
        setVersion(v => v + 1);
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
    await tick(40);
    flush();
    stuck();
    flush();
    await tick(5);
    flush();
    swap();
    flush();
    await tick(100);
    flush();
    expect(frames).toEqual(["a:0 b:1 c:2", "b:1 a:0 c:2", "b:0 a:1 c:2"]);
  });
});
