/**
 * An optimistic guess that puts a DIFFERENT row object at an index, where
 * the store's arrangement comparator still calls it "the same row", left a
 * list over the store (`mapArray`, what `<For>` runs) holding the old row
 * proxy. Direct reads used the new row, so a later edit to that row showed
 * in direct reads but not on screen.
 *
 *   A. keyless rows with identical contents, swapped in the draft:
 *      guess: direct 2,1 / screen 1,2
 *   B. a fresh row with the same `id` returned from the setter:
 *      guess: direct 2,1 / screen 1,1
 *   C. a fresh keyless row with the same contents returned from the setter:
 *      guess: direct 2,1 / screen 1,1
 *
 * Plain `createStore` and `createProjection` agree in every case (controls).
 *
 * Fails on rc.19 and on `next` (A and C since #3937, B since before rc.14).
 * The arrangement comparator now treats a row the store already serves as
 * its proxy's row.
 */
import { expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray
} from "../src/index.js";

type Row = { id?: number; n: number };
const row = (id: boolean, n: number, i: number): Row => (id ? { id: i, n } : { n });
const cases = [
  { name: "A. keyless identical rows swapped in the draft", id: false, mode: "swap" },
  { name: "B. fresh row with the same id returned", id: true, mode: "fresh" },
  { name: "C. fresh keyless row with the same contents returned", id: false, mode: "fresh" }
] as const;
const replace = (id: boolean, mode: "swap" | "fresh") =>
  mode === "swap"
    ? (d: Row[]) => {
        const x = d[0];
        d[0] = d[1];
        d[1] = x;
      }
    : () => [row(id, 1, 1), row(id, 1, 2)];

function mount(items: () => Row[], keyed: boolean) {
  const out = { screen: "" };
  const list = keyed
    ? mapArray(items, (r: Row) => () => r.n)
    : mapArray(items, (r: () => Row) => () => r().n, { keyed: false });
  createRenderEffect(
    () =>
      list()
        .map(f => f())
        .join(","),
    v => {
      out.screen = v;
    }
  );
  return out;
}

for (const c of cases)
  for (const keyed of [true, false]) {
    test(`optimistic: ${c.name} (keyed: ${keyed})`, async () => {
      let items!: Row[];
      let set!: (fn: (d: Row[]) => Row[] | void) => void;
      let out!: { screen: string };
      createRoot(() => {
        [items, set] = createOptimisticStore<Row[]>([row(c.id, 1, 1), row(c.id, 1, 2)]);
        out = mount(() => items, keyed);
      });
      flush();
      let release!: () => void;
      const server = new Promise<void>(r => (release = r));
      const done = action(function* () {
        set(replace(c.id, c.mode));
        set(d => {
          d[0].n = 2;
        });
        yield server;
      })();
      flush();
      const direct = () => items.map(r => r.n).join(",");
      expect(`direct ${direct()} / screen ${out.screen}`).toBe("direct 2,1 / screen 2,1");
      release();
      await done;
      flush();
      expect(`direct ${direct()} / screen ${out.screen}`).toBe("direct 1,1 / screen 1,1");
    });

    test(`control, createStore: ${c.name} (keyed: ${keyed})`, () => {
      let items!: Row[];
      let set!: (fn: (d: Row[]) => Row[] | void) => void;
      let out!: { screen: string };
      createRoot(() => {
        [items, set] = createStore<Row[]>([row(c.id, 1, 1), row(c.id, 1, 2)]);
        out = mount(() => items, keyed);
      });
      flush();
      set(replace(c.id, c.mode));
      set(d => {
        d[0].n = 2;
      });
      flush();
      expect(`direct ${items.map(r => r.n).join(",")} / screen ${out.screen}`).toBe(
        "direct 2,1 / screen 2,1"
      );
    });

    test(`control, createProjection: ${c.name} (keyed: ${keyed})`, () => {
      const [src, setSrc] = createSignal<Row[]>([row(c.id, 1, 1), row(c.id, 1, 2)]);
      let items!: Row[];
      let out!: { screen: string };
      createRoot(() => {
        items = createProjection<Row[]>(() => src(), []);
        out = mount(() => items, keyed);
      });
      flush();
      const v = src();
      setSrc(c.mode === "swap" ? [v[1], v[0]] : [row(c.id, 1, 1), row(c.id, 1, 2)]);
      flush();
      setSrc(src().map((r, i) => (i === 0 ? { ...r, n: 2 } : r)));
      flush();
      expect(`direct ${items.map(r => r.n).join(",")} / screen ${out.screen}`).toBe(
        "direct 2,1 / screen 2,1"
      );
    });
  }

// The same guesses over a derived store whose truth the action writes: the
// landing pairs with the row the screen shows, and a later action's edit of
// that row reaches the screen.
for (const c of cases)
  for (const keyed of [true, false])
    test(`optimistic, derived: ${c.name}, the truth lands, a later edit shows (keyed: ${keyed})`, async () => {
      const tick = () => new Promise(r => setTimeout(r, 0));
      const [src, setSrc] = createSignal<Row[]>([row(c.id, 1, 1), row(c.id, 1, 2)]);
      let items!: Row[];
      let set!: (fn: (d: Row[]) => Row[] | void) => void;
      let out!: { screen: string };
      createRoot(() => {
        [items, set] = createOptimisticStore<Row[]>(() => src().map(r => ({ ...r })), []) as any;
        out = mount(() => items, keyed);
      });
      flush();
      await tick();
      flush();
      const frames: string[] = [];
      const snap = (at: string) =>
        frames.push(`${at}: direct ${items.map(r => r.n).join(",")} / screen ${out.screen}`);
      let release!: () => void;
      const server = new Promise<void>(r => (release = r));
      const done = action(function* () {
        set(replace(c.id, c.mode));
        set(d => {
          d[0].n = 2;
        });
        yield server;
        setSrc([row(c.id, 2, 1), row(c.id, 1, 2)]);
      })();
      flush();
      snap("guess");
      release();
      await done;
      flush();
      await tick();
      flush();
      snap("settle");
      let release2!: () => void;
      const server2 = new Promise<void>(r => (release2 = r));
      const done2 = action(function* () {
        set(d => {
          d[1].n = 3;
        });
        yield server2;
      })();
      flush();
      snap("second guess");
      release2();
      await done2;
      flush();
      snap("second settle");
      expect(frames).toEqual([
        "guess: direct 2,1 / screen 2,1",
        "settle: direct 2,1 / screen 2,1",
        "second guess: direct 2,3 / screen 2,3",
        "second settle: direct 2,1 / screen 2,1"
      ]);
    });
