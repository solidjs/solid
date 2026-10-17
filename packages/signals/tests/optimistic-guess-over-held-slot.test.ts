import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(n = 3) {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
}

// The board example's rapid adds against a slow server: each add pushes a
// row optimistically, the server commits it to the live source, and the
// action holds until the source carries the row. When `a`'s commit lands
// while `b` is in flight, `a`'s landing corrects the shared slot (`length`,
// the array) and leaves it held by the a+b transaction, showing `a, b`. A
// third add `c` then guesses over that held slot. Its guess composes on the
// held value, so it is a second suggestion for the slot (A34 (1)) and must
// finish with it, under its own action's hold (F-11). It was opened as a lane
// under the holder alone: `b`'s commit corrected it and `b`'s landing
// reverted it, so `c` showed, vanished, and came back with its own commit.
type Row = { id: string };

function board(store: boolean) {
  const [source, setSource] = createSignal<Row[]>([]);
  const shown: string[] = [];
  let ids!: () => string;
  let push!: (id: string) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    if (store) {
      const [rows, setRows] = createOptimisticStore<Row[]>(() => source(), []);
      ids = () => rows.map(r => r.id).join(",");
      push = id => setRows(draft => void draft.push({ id }));
    } else {
      const [rows, setRows] = createOptimistic(() => source(), {
        equals: (a, b) => a.map(r => r.id).join() === b.map(r => r.id).join()
      });
      ids = () =>
        rows()
          .map(r => r.id)
          .join(",");
      push = id => setRows(prev => [...prev, { id }]);
    }
    createRenderEffect(ids, v => void shown.push(v));
  });
  flush();

  const server: Row[] = [];
  const respond: Record<string, () => void> = {};
  const pending: Promise<void>[] = [];
  const add = action(function* (id: string) {
    push(id);
    yield new Promise<void>(r => (respond[id] = r));
    yield until(() => ids().split(",").includes(id), { timeout: 1000 });
  });
  return {
    shown,
    dispose,
    async start(id: string) {
      pending.push(add(id));
      await drain();
    },
    // The server commits the row to the live source, then answers the call.
    async commit(id: string) {
      server.push({ id });
      setSource(server.map(r => ({ ...r })));
      await drain();
      respond[id]();
      await drain();
    },
    settled: () => Promise.all(pending)
  };
}

describe("a guess over a slot another action holds (A34 (1), F-11)", () => {
  for (const store of [true, false])
    it(`${store ? "createOptimisticStore" : "createOptimistic"}: a row that showed never vanishes`, async () => {
      const b = board(store);
      await b.start("a");
      await b.start("b");
      await b.commit("a");
      await b.start("c");
      await b.commit("b");
      await b.commit("c");
      await b.settled();
      await drain();

      // Every shown frame keeps every row an earlier frame showed.
      const seen = new Set<string>();
      for (const frame of b.shown) {
        const rows = frame ? frame.split(",") : [];
        for (const id of seen) expect(rows, `frames: ${JSON.stringify(b.shown)}`).toContain(id);
        for (const id of rows) seen.add(id);
      }
      expect(b.shown.at(-1)).toBe("a,b,c");
      b.dispose();
    });
});
