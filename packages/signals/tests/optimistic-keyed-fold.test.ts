/**
 * A keyed store's arrangement guess is rows by key: a current truth that
 * differs folds beneath it instead of voiding it (D-34, 2026-10-21).
 *
 * The case that needed it: two overlapping actions push onto one optimistic
 * store, and the stream echoes the first write while the second is still
 * open. Voiding the lane on that correction left the store torn for the
 * window (index 1 a hole, `length` the guess's, a raw target served for a
 * row) and remounted the first row twice at the commit — in a board, an open
 * title editor and its draft went with it. Folded, the screen keeps the
 * guesses until the hold commits, and at the commit rows match by key: no
 * row remounts, and the second action's guess survives the first's echo.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
  TimeoutError,
  until
} from "../src/index.js";

type Row = { id: string; title: string };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const row = (id: string, title = id): Row => ({ id, title });

/** A keyed optimistic list over a signal source (a live stream's latest
 * snapshot), mapped by `mapArray` and rendered. Rows are tagged with an
 * identity counter so a replacement shows as a new `#n`. */
function setup(initial: Row[], nested = false) {
  const [source, setSource] = createSignal<Row[]>(initial);
  const frames: string[] = [];
  const mapped: (Row | undefined)[] = [];
  let mounts = 0;
  let unmounts = 0;
  let get!: () => Row[];
  let set!: (fn: (d: Row[]) => void) => void;
  createRoot(() => {
    if (nested) {
      const [s, ss] = createOptimisticStore<{ cards: Row[] }>(() => ({ cards: source() }), {
        cards: []
      });
      get = () => s.cards;
      set = fn => ss(d => fn(d.cards));
    } else {
      const [s, ss] = createOptimisticStore<Row[]>(() => source(), []);
      get = () => s;
      set = fn => ss(d => fn(d));
    }
    const rows = mapArray(get, (r: Row) => {
      mapped.push(r);
      mounts++;
      onCleanup(() => unmounts++);
      return r;
    });
    createRenderEffect(
      () =>
        rows()
          .map(r => r.id)
          .join(","),
      v => void frames.push(v)
    );
  });
  flush();
  const ids = new WeakMap<object, number>();
  let n = 0;
  const tag = (o: object) => (ids.has(o) ? ids.get(o)! : (ids.set(o, ++n), n));
  return {
    setSource,
    frames,
    mapped,
    get rows() {
      return get();
    },
    set,
    snap: () => Array.from(get(), r => (r ? `${r.id}#${tag(r)}` : "HOLE")).join(","),
    counts: () => ({ mounts, unmounts })
  };
}

const push = (h: ReturnType<typeof setup>, id: string, timeout?: number) =>
  action(function* () {
    h.set(d => void d.push(row(id)));
    yield sleep(5);
    yield until(() => h.rows.some(r => r.id === id), timeout ? { timeout } : undefined);
  })();

describe("keyed arrangement guess: a correction folds beneath it (D-34)", () => {
  for (const nested of [false, true]) {
    it(`two overlapping pushes, the first echoed alone: the store stays whole and no row remounts${nested ? " (nested)" : ""}`, async () => {
      const h = setup([row("a")], nested);
      const p1 = push(h, "b");
      flush();
      await sleep(2);
      const p2 = push(h, "c");
      flush();
      await sleep(10);
      expect(h.snap()).toBe("a#1,b#2,c#3");

      h.setSource([row("a"), row("b")]);
      flush();
      // The window: the second guess is still in force. Every read sees the
      // guessed arrangement whole — a third write computing a position reads
      // this too.
      expect(h.rows.length).toBe(3);
      expect(Object.keys(h.rows)).toEqual(["0", "1", "2"]);
      expect(h.snap()).toBe("a#1,b#2,c#3");
      await p1;

      h.setSource([row("a"), row("b"), row("c")]);
      flush();
      await p2;
      flush();
      await sleep(5);
      expect(h.snap()).toBe("a#1,b#2,c#3");
      expect(h.frames).toEqual(["a", "a,b", "a,b,c"]);
      expect(h.counts()).toEqual({ mounts: 3, unmounts: 0 });
    });
  }

  it("another tab's row lands while a push is open: the screen keeps the guess until the settle, then shows both, the pushed row keeping its identity", async () => {
    const h = setup([row("a")]);
    const p = push(h, "b");
    flush();
    await sleep(10);
    h.setSource([row("a"), row("z")]);
    flush();
    expect(h.snap()).toBe("a#1,b#2");
    expect(h.frames.at(-1)).toBe("a,b");
    await sleep(5);
    h.setSource([row("a"), row("z"), row("b")]);
    flush();
    await p;
    flush();
    await sleep(5);
    expect(h.snap()).toBe("a#1,z#3,b#2");
    expect(h.frames).toEqual(["a", "a,b", "a,z,b"]);
    expect(h.counts()).toEqual({ mounts: 3, unmounts: 0 });
  });

  it("overlapping pushes with another tab's change in the window: nothing remounts, the change shows with the settle", async () => {
    const h = setup([row("a")]);
    const p1 = push(h, "b");
    flush();
    await sleep(2);
    const p2 = push(h, "c");
    flush();
    await sleep(10);
    h.setSource([row("a"), row("b")]);
    flush();
    await p1;
    await sleep(5);
    h.setSource([row("a", "A!"), row("b"), row("z")]);
    flush();
    expect(h.snap()).toBe("a#1,b#2,c#3");
    await sleep(5);
    h.setSource([row("a", "A!"), row("b"), row("z"), row("c")]);
    flush();
    await p2;
    flush();
    await sleep(5);
    expect(h.snap()).toBe("a#1,b#2,z#4,c#3");
    expect(h.rows[0].title).toBe("A!");
    expect(h.counts()).toEqual({ mounts: 4, unmounts: 0 });
  });

  it("the second push never confirmed: it times out and reverts; the first's row keeps its identity", async () => {
    const h = setup([row("a")]);
    const p1 = push(h, "b", 1000);
    flush();
    await sleep(2);
    const p2 = push(h, "c", 60).catch(e => e);
    flush();
    await sleep(10);
    h.setSource([row("a"), row("b")]);
    flush();
    await p1;
    expect(await p2).toBeInstanceOf(TimeoutError);
    flush();
    await sleep(5);
    expect(h.snap()).toBe("a#1,b#2");
    expect(h.counts()).toEqual({ mounts: 3, unmounts: 1 });
  });

  for (const where of ["in the action", "on mainline"]) {
    it(`a truth longer than a reorder guess (${where}): a list pass never pairs the truth's length with the guess's rows`, async () => {
      const h = setup([row("a"), row("b")]);
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      const truth = [row("b"), row("a"), row("s")];
      const p = action(function* () {
        h.set(d => void d.reverse());
        yield gate;
        if (where === "in the action") h.setSource(truth);
      })();
      flush();
      if (where === "on mainline") {
        h.setSource(truth);
        flush();
      }
      release();
      await p;
      flush();
      await sleep(1);
      flush();
      expect(h.mapped.every(r => r !== undefined)).toBe(true);
      expect(h.frames).toEqual(["a,b", "b,a", "b,a,s"]);
      expect(h.counts()).toEqual({ mounts: 3, unmounts: 0 });
    });
  }
});
