/**
 * Signal twins of the Q-D store pins (plan §39, §39.1): the same shape on
 * `createOptimistic` nodes and on an optimistic store, judged by the same
 * rule — a landing is the answer to the question that asked it; an older
 * action's landing beneath a newer action's guess is held beneath, the
 * guess keeps showing, the guess's own landing judges (#3331, A18).
 *
 * The parity the maintainer asked for (2026-10-03): the store half must
 * never disagree with the signal half. Each `describe` runs the signal
 * shape and the store shape side by side and asserts the same frames.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  refresh,
  type SourceAccessor
} from "../../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await tick();
    flush();
  }
};
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};

type Row = { id: string; text: string };
const rows = (): Row[] => [
  { id: "a", text: "A" },
  { id: "b", text: "B" },
  { id: "c", text: "C" }
];
const frameOf = (list: readonly Row[]) => list.map(r => `${r.id}:${r.text}`).join(",");

describe("Q-D twins — two actions, one list; the older landing beneath the newer guess", () => {
  // Signals: the list is two slots — the row texts and the order — each an
  // optimistic node deriving from one async upstream. A edits c's text, B
  // swaps the order; A's refetch lands first.
  async function signalShape() {
    let resolveUp: Array<(v: Row[]) => void> = [];
    let upstream!: SourceAccessor<Row[]>;
    let textC!: SourceAccessor<string>;
    let setTextC!: (v: string) => void;
    let order!: SourceAccessor<string[]>;
    let setOrder!: (v: string[]) => void;
    const frames: string[] = [];
    createRoot(() => {
      upstream = createMemo(() => new Promise<Row[]>(r => resolveUp.push(r)));
      [textC, setTextC] = createOptimistic(() => upstream().find(r => r.id === "c")!.text);
      // The store judges an arrangement by row key; the signal twin's node
      // gets the same knowledge as its comparator (a fresh array from the
      // server with the same order is the same arrangement).
      [order, setOrder] = createOptimistic(() => upstream().map(r => r.id), {
        equals: (a, b) => a.join() === b.join()
      });
      createRenderEffect(
        () =>
          order()
            .map(id => `${id}:${id === "c" ? textC() : id.toUpperCase()}`)
            .join(","),
        v => void frames.push(v)
      );
    });
    flush();
    resolveUp.shift()!(rows());
    await settle();
    let server = rows();
    const run = (edit: (l: Row[]) => void, guess: () => void) => {
      const g = gate();
      const done = action(function* () {
        guess();
        yield g.promise;
        edit(server);
        refresh(upstream);
      })();
      return { done, release: g.release };
    };
    return {
      frames,
      land: () => resolveUp.shift()!(server.map(r => ({ ...r }))),
      A: () =>
        run(
          l => void (l.find(r => r.id === "c")!.text = "C!"),
          () => setTextC("C!")
        ),
      B: () =>
        run(
          l => void l.unshift(l.splice(1, 1)[0]),
          () => setOrder(["b", "a", "c"])
        ),
      read: () =>
        order()
          .map(id => `${id}:${id === "c" ? textC() : id.toUpperCase()}`)
          .join(","),
      pending: () => isPending(() => order())
    };
  }

  async function storeShape() {
    let resolveUp: Array<(v: Row[]) => void> = [];
    let list!: Row[];
    let setList!: (fn: (d: Row[]) => void) => void;
    const frames: string[] = [];
    createRoot(() => {
      [list, setList] = createOptimisticStore<Row[]>(
        () => new Promise<Row[]>(r => resolveUp.push(r)),
        [],
        { key: "id" }
      );
      createRenderEffect(
        () => frameOf(list),
        v => void frames.push(v)
      );
    });
    flush();
    resolveUp.shift()!(rows());
    await settle();
    let server = rows();
    const run = (edit: (l: Row[]) => void, guess: (d: Row[]) => void) => {
      const g = gate();
      const done = action(function* () {
        setList(guess);
        yield g.promise;
        edit(server);
        refresh(list as any);
      })();
      return { done, release: g.release };
    };
    return {
      frames,
      land: () => resolveUp.shift()!(server.map(r => ({ ...r }))),
      A: () =>
        run(
          l => void (l.find(r => r.id === "c")!.text = "C!"),
          d => void (d[2].text = "C!")
        ),
      B: () =>
        run(
          l => void l.unshift(l.splice(1, 1)[0]),
          d => {
            const t = d[0];
            d[0] = d[1];
            d[1] = t;
          }
        ),
      read: () => frameOf(list),
      pending: () => isPending(() => list.length)
    };
  }

  for (const [name, shape] of [
    ["signals", signalShape],
    ["store", storeShape]
  ] as const) {
    it(`${name}: B's swap never disappears while A's landing waits beneath it`, async () => {
      const s = await shape();
      expect(s.frames.at(-1)).toBe("a:A,b:B,c:C");
      const a = s.A();
      flush();
      expect(s.frames.at(-1)).toBe("a:A,b:B,c:C!");
      const b = s.B();
      flush();
      expect(s.frames.at(-1)).toBe("b:B,a:A,c:C!");
      const applied = s.frames.length;

      // A confirms first: its landing is an OLDER question than B's guess —
      // held beneath, the display unchanged, no frame published.
      a.release();
      await a.done;
      await settle();
      s.land();
      await settle();
      expect(s.frames.at(-1)).toBe("b:B,a:A,c:C!");
      expect(s.frames.slice(applied)).toEqual([]);
      expect(s.read()).toBe("b:B,a:A,c:C!");

      // B confirms: its own landing judges — equal, silent.
      b.release();
      await b.done;
      await settle();
      s.land();
      await settle();
      expect(s.frames.at(-1)).toBe("b:B,a:A,c:C!");
      expect(s.frames.slice(applied)).toEqual([]);
      expect(s.read()).toBe("b:B,a:A,c:C!");
      expect(s.pending()).toBe(false);
    });
  }
});

describe("Kanban A17 twins — plain truth written and shadowed optimistically in one action; a reader mounted mid-move", () => {
  function signalShape() {
    const [error, setError] = createSignal<string | null>("stale error");
    const [shadow, setShadow] = createOptimistic<string | null>(() => error());
    const [dragging, setDragging] = createSignal<string | null>(null);
    createRoot(() => {
      createRenderEffect(
        () => shadow(),
        () => {}
      );
    });
    flush();
    const g = gate();
    const done = action(function* () {
      setError(null);
      setShadow(null);
      yield g.promise;
    })();
    return {
      done,
      release: g.release,
      flag: () => shadow(),
      truth: () => error(),
      dragging,
      setDragging
    };
  }

  function storeShape() {
    const [base, setBase] = createStore<{ error: string | null }>({ error: "stale error" });
    const [view, setView] = createOptimisticStore(base);
    const [dragging, setDragging] = createSignal<string | null>(null);
    createRoot(() => {
      createRenderEffect(
        () => view.error,
        () => {}
      );
    });
    flush();
    const g = gate();
    const done = action(function* () {
      setBase(d => {
        d.error = null;
      });
      setView(d => {
        d.error = null;
      });
      yield g.promise;
    })();
    return {
      done,
      release: g.release,
      flag: () => view.error,
      truth: () => base.error,
      dragging,
      setDragging
    };
  }

  for (const [name, shape] of [
    ["signals", signalShape],
    ["store", storeShape]
  ] as const) {
    it(`${name}: the ghost shows the guess now, an unrelated write shows with it, the landing moves nothing`, async () => {
      const s = shape();
      flush();
      expect(s.flag()).toBe(null); // the guess
      expect(s.truth()).toBe("stale error"); // the plain truth is held under the move

      const ghost: string[] = [];
      createRoot(() => {
        const show = createMemo(() => (s.flag() === null ? "ghost" : "(none)"));
        createRenderEffect(
          () => `drag=${s.dragging() ?? "no"} ${show()}`,
          v => void ghost.push(v)
        );
      });
      flush();
      expect(ghost).toEqual(["drag=no ghost"]);

      s.setDragging("a");
      flush();
      expect(ghost.at(-1)).toBe("drag=a ghost");
      expect(isPending(() => s.dragging())).toBe(false);
      expect(latest(() => s.flag())).toBe(null);
      expect(isPending(() => s.flag())).toBe(false); // the guess equals the truth beneath (A24)

      s.release();
      await s.done;
      await settle();
      expect(ghost).toEqual(["drag=no ghost", "drag=a ghost"]);
      expect(s.flag()).toBe(null);
      expect(s.truth()).toBe(null);
    });
  }
});
