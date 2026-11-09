/**
 * A derived store whose derive reads a keyed optimistic store through
 * `latest()` picks up every confirmed row's key once the actions settle.
 *
 * Two overlapping pushes put `b` and `c` in flight; the source echoing only
 * `b` folds the truth beneath the guess (D-34), so `latest()` serves the
 * truth from there (`foldedRead`). A third push `e` starts after that
 * correction. When the source confirms `c` and `e`, the new truth equals the
 * guess — a confirming landing — but it is still a new truth beneath the
 * folded guess: the `latest()` readers must re-derive from it (D-34, F-6).
 * Before the fix they were never notified, and at the lane's end the commit
 * matched the guess the screen showed, so nothing re-ran them either: the
 * derive stayed on `{ a, b, c }` with `e` missing for good, while the same
 * derive reading the rows plainly had all four keys.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest,
  until
} from "../../src/index.js";

type Row = { id: string; title: string };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const row = (id: string): Row => ({ id, title: id });

describe("a latest() derive over a folded optimistic store sees the confirming truth", () => {
  for (const read of ["plain", "latest", "memo-latest"] as const)
    it(`derive reads the rows ${read === "plain" ? "plainly" : `through ${read}`}`, async () => {
      const [source, setSource] = createSignal<Row[]>([row("a")]);
      let opt!: Row[];
      let set!: (fn: (d: Row[]) => void) => void;
      let der!: Record<string, string>;
      const dispose = createRoot(dispose => {
        const [s, ss] = createOptimisticStore<Row[]>(() => source(), []);
        opt = s;
        set = fn => ss(d => fn(d));
        const m = createMemo(() => latest(() => s.map(r => r.id)));
        const [d] = createStore<Record<string, string>>(dd => {
          const ids =
            read === "plain"
              ? s.map(r => r.id)
              : read === "latest"
                ? latest(() => s.map(r => r.id))
                : m();
          for (const id of ids) dd[id] = "v" + id;
        }, {});
        der = d;
        // A reader of the last row's key, so a leaf is born for each new row.
        createRenderEffect(
          () => {
            const ids = s.map(r => r.id);
            return der[ids[ids.length - 1]];
          },
          () => {}
        );
        return dispose;
      });
      flush();
      const push = (id: string) =>
        action(function* () {
          set(d => void d.push(row(id)));
          yield sleep(5);
          yield until(() => opt.some(r => r.id === id));
        })();

      const p1 = push("b");
      flush();
      await sleep(2);
      const p2 = push("c");
      flush();
      await sleep(10);
      setSource([row("a"), row("b")]); // echoes the first push only: the truth folds (D-34)
      flush();
      const p3 = push("e");
      flush();
      await p1;
      setSource([row("a"), row("b"), row("c"), row("e")]); // confirms c and e
      flush();
      await p2;
      await p3;
      flush();
      await sleep(5);
      flush();

      expect(opt.map(r => r.id)).toEqual(["a", "b", "c", "e"]);
      expect({ ...der }).toEqual({ a: "va", b: "vb", c: "vc", e: "ve" });
      dispose();
    });
});
