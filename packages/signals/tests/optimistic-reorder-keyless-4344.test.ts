/**
 * #4344 — an optimistic reorder inside an action, on rows without an `id`,
 * showed to direct reads but not to a list over the store (`mapArray`, what
 * `<For>` runs). The setter's returned array is written by index: each slot
 * gets the returned row. The container's arrangement guess was judged equal
 * to the committed rows, because two keyless rows at the same index counted
 * as the same row (#3898). The guess was dropped, so the list never re-ran.
 * A keyless row has only its contents. At the same index it is the same row
 * when its contents match (the #3898 echo), and a different row otherwise.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

type Row = { id?: string; name: string };
const tick = () => new Promise(r => setTimeout(r, 0));

function setup(keyed: boolean, withId: boolean, derived: boolean) {
  const row = (n: string): Row => (withId ? { id: n, name: n } : { name: n });
  const [source, setSource] = createSignal<Row[]>([row("a"), row("b"), row("c")]);
  let items!: Row[];
  let setItems!: (fn: (d: Row[]) => Row[] | void) => void;
  let screen = "";
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [items, setItems] = derived
      ? (createOptimisticStore<Row[]>(() => source().map(r => ({ ...r })), []) as any)
      : createOptimisticStore<Row[]>([row("a"), row("b"), row("c")]);
    const list = keyed
      ? mapArray(
          () => items,
          (r: Row) => () => r.name
        )
      : mapArray(
          () => items,
          (r: () => Row) => () => r().name,
          { keyed: false }
        );
    createRenderEffect(
      () =>
        list()
          .map(f => f())
          .join(","),
      v => {
        screen = v;
      }
    );
  });
  flush();
  return {
    row,
    setSource,
    get items() {
      return items.map(r => r.name).join(",");
    },
    get screen() {
      return screen;
    },
    setItems,
    dispose
  };
}

for (const derived of [false, true])
  for (const withId of [false, true])
    for (const keyed of [true, false])
      describe(`${derived ? "derived" : "plain"} store, keyed: ${keyed}, rows have id: ${withId}`, () => {
        test("a returned reorder shows to the list at once and reverts at the settle", async () => {
          const s = setup(keyed, withId, derived);
          await tick();
          flush();
          expect(s.screen).toBe("a,b,c");
          let release!: () => void;
          const server = new Promise<void>(r => (release = r));
          const done = action(function* () {
            s.setItems(() => [s.row("c"), s.row("b"), s.row("a")]);
            yield server;
          })();
          flush();
          expect(s.items).toBe("c,b,a");
          expect(s.screen).toBe("c,b,a");
          await tick();
          flush();
          expect(s.items).toBe("c,b,a");
          expect(s.screen).toBe("c,b,a");
          release();
          await done;
          flush();
          // Nothing wrote the truth: the guess reverts.
          expect(s.items).toBe("a,b,c");
          expect(s.screen).toBe("a,b,c");
          s.dispose();
        });

        test("a swap written in the draft shows to the list at once and reverts", async () => {
          const s = setup(keyed, withId, derived);
          await tick();
          flush();
          let release!: () => void;
          const server = new Promise<void>(r => (release = r));
          const done = action(function* () {
            s.setItems(d => {
              const x = d[0];
              d[0] = d[2];
              d[2] = x;
            });
            yield server;
          })();
          flush();
          expect(s.items).toBe("c,b,a");
          expect(s.screen).toBe("c,b,a");
          release();
          await done;
          flush();
          expect(s.items).toBe("a,b,c");
          expect(s.screen).toBe("a,b,c");
          s.dispose();
        });

        if (derived)
          test("the truth the action writes lands the reorder at the settle", async () => {
            const s = setup(keyed, withId, derived);
            await tick();
            flush();
            let release!: () => void;
            const server = new Promise<void>(r => (release = r));
            const done = action(function* () {
              s.setItems(() => [s.row("c"), s.row("b"), s.row("a")]);
              yield server;
              s.setSource([s.row("c"), s.row("b"), s.row("a")]);
            })();
            flush();
            expect(s.items).toBe("c,b,a");
            expect(s.screen).toBe("c,b,a");
            release();
            await done;
            flush();
            await tick();
            flush();
            expect(s.items).toBe("c,b,a");
            expect(s.screen).toBe("c,b,a");
            s.dispose();
          });
      });
