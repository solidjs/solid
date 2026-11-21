// #5100: a declined rename guess on a row reverts when its list's re-ask lands
// with the server's value, without waiting for unrelated moves still pending
// on another list (D-33: disjoint slots settle independently; D-34: a different
// truth corrects the graph now and the screen at the commit).
import { expect, test } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const V of ["nofail", "base", "bare"] as const) {
  test(`#5100 ${V}: a declined rename reverts at its list's landing while unrelated moves on another list are still pending`, async () => {
    const asks: { k: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
    const take = (k: string) => {
      const i = asks.findIndex(a => a.k === k);
      if (i < 0) throw new Error(`no ask ${k} in ${asks.map(a => a.k)}`);
      return asks.splice(i, 1)[0];
    };
    const server: Record<string, any[]> = {
      a: [
        { id: 1, t: "W" },
        { id: 2, t: "F" }
      ],
      b: [
        { id: 3, t: "R" },
        { id: 4, t: "D" }
      ]
    };
    const answer = (k: string) => take(k).res(structuredClone(server[k]));
    const shown: Record<number, string> = {};
    let detail: string | null = null;
    let api: any;
    const dispose = createRoot(dispose => {
      const C: Record<string, any> = {};
      for (const k of ["a", "b"]) {
        const [ans] = createSignal(async () => await ask(k), { loadingValue: null } as any);
        const [rows, setRows] = createOptimisticStore(
          () => ans() ?? [],
          [] as any[],
          { key: "id" } as any
        );
        C[k] = { ans, rows, setRows };
      }
      const [selected, setSelected] = createSignal<number | null>(null);
      const sel = createMemo(() => C.b.rows.find((r: any) => r.id === selected()) ?? null);
      const move = action(function* (k: string, id: number) {
        try {
          const row = { ...C[k].rows.find((r: any) => r.id === id) };
          C[k].setRows((rs: any[]) => [...rs.filter(r => r.id !== id), row]);
          yield ask("move" + id);
          refresh(C.a.ans);
          refresh(C.b.ans);
        } catch {}
      });
      const rename = action(function* (i: number, t: string) {
        try {
          C.b.setRows((rs: any[]) => {
            rs[i].t = t;
          });
          yield ask("rename");
          refresh(C.b.ans);
        } catch {}
      });
      api = { move, rename, setSelected };

      const mountList = () => {
        const rows = mapArray(
          () => C.b.rows,
          (r: any) => {
            createRenderEffect(
              () => [r.id, r.t],
              ([id, t]) => {
                shown[id] = t;
              }
            );
            return r;
          }
        );
        createRenderEffect(rows, () => {});
        return rows;
      };

      const listBoundary = createErrorBoundary(
        () => {
          if (V === "bare") return mountList();
          return createMemo(() => (C.b.ans() != null ? mountList() : null));
        },
        () => null
      );
      createRenderEffect(
        () => {
          const v = listBoundary();
          if (typeof v === "function") v();
        },
        () => {}
      );

      const detailBoundary = createErrorBoundary(
        () => createMemo(() => (sel() ? sel().t : null)),
        () => null
      );
      createRenderEffect(
        () => {
          const v = detailBoundary();
          return typeof v === "function" ? v() : v;
        },
        t => {
          detail = t;
        }
      );
      return dispose;
    });

    flush();
    await tick();
    answer("a");
    await tick();
    // 1. A move guesses on `a`.
    api.move("a", 1);
    await tick();
    answer("b");
    await tick();
    // 2. While it is out, a second move guesses on `b` ([3, 4] -> [4, 3]).
    api.move("b", 3);
    await tick();
    // 3. The first move is accepted and re-asks both lists.
    server.a = [server.a[1], server.a[0]];
    take("move1").res(true);
    await tick();
    api.setSelected(4);
    await tick();
    if (V === "nofail") answer("b");
    else take("b").rej(new Error("down"));
    await tick();
    // 4. The second move is accepted and re-asks both lists.
    server.b = [server.b[1], server.b[0]];
    take("move3").res(true);
    await tick();
    // 5. A rename guesses on `b[0]` (#4) and is declined.
    api.rename(0, "A");
    await tick();
    take("rename").rej(new Error("declined"));
    await tick();
    // 6. `b`'s re-ask lands with #4 D; `a`'s two re-asks are still out.
    answer("b");
    await tick();

    expect({ row: shown[4], detail }).toEqual({ row: "D", detail: "D" });

    // Cleanup remaining asks.
    while (asks.length) {
      const k = asks[0].k;
      answer(k);
      await tick();
    }
    expect({ row: shown[4], detail }).toEqual({ row: "D", detail: "D" });
    dispose();
  });
}

test("#5100 control (D-33): a declined guess on an unchanged key of a held container reverts while the other hold is still open", async () => {
  const [src, setSrc] = createSignal({ a: 0, b: 0 });
  let releaseHold!: () => void;
  let releaseGuess!: () => void;
  let state!: { a: number; b: number };
  let setState!: any;
  let seen = { a: 0, b: 0 };
  const dispose = createRoot(dispose => {
    [state, setState] = createOptimisticStore(() => ({ ...src() }), { a: 0, b: 0 });
    createRenderEffect(
      () => ({ a: state.a, b: state.b }),
      v => {
        seen = v;
      }
    );
    return dispose;
  });
  flush();
  expect(seen).toEqual({ a: 0, b: 0 });

  const holdA = action(function* () {
    setSrc({ a: 1, b: 0 });
    yield new Promise<void>(r => (releaseHold = r));
  });
  const guessB = action(function* () {
    setState((s: any) => {
      s.b = 99;
    });
    yield new Promise<void>(r => (releaseGuess = r));
  });

  const doneHold = holdA();
  await tick();
  expect(seen).toEqual({ a: 0, b: 0 });

  const doneGuess = guessB();
  await tick();
  expect(seen).toEqual({ a: 0, b: 99 });

  // Disjoint slot `b` was not changed by `holdA`: ending `guessB` reverts `b` now.
  releaseGuess();
  await doneGuess;
  await tick();
  expect(seen).toEqual({ a: 0, b: 0 });

  releaseHold();
  await doneHold;
  await tick();
  expect(seen).toEqual({ a: 1, b: 0 });
  dispose();
});

test("#5100 control (D-33): a guess on a key actually changed by a held container entangles with that hold", async () => {
  const [src, setSrc] = createSignal({ a: 0, b: 0 });
  let releaseHold!: () => void;
  let releaseGuess!: () => void;
  let state!: { a: number; b: number };
  let setState!: any;
  let seen = { a: 0, b: 0 };
  const dispose = createRoot(dispose => {
    [state, setState] = createOptimisticStore(() => ({ ...src() }), { a: 0, b: 0 });
    createRenderEffect(
      () => ({ a: state.a, b: state.b }),
      v => {
        seen = v;
      }
    );
    return dispose;
  });
  flush();

  const holdA = action(function* () {
    setSrc({ a: 1, b: 0 });
    yield new Promise<void>(r => (releaseHold = r));
  });
  const guessA = action(function* () {
    setState((s: any) => {
      s.a = 99;
    });
    yield new Promise<void>(r => (releaseGuess = r));
  });

  const doneHold = holdA();
  await tick();
  expect(seen).toEqual({ a: 0, b: 0 });

  const doneGuess = guessA();
  await tick();
  expect(seen).toEqual({ a: 99, b: 0 });

  // Same slot `a` IS changed by `holdA`: entangled until `holdA` settles, then lands on 1.
  releaseGuess();
  await doneGuess;
  await tick();
  expect(seen).toEqual({ a: 99, b: 0 });

  releaseHold();
  await doneHold;
  await tick();
  expect(seen).toEqual({ a: 1, b: 0 });
  dispose();
});

test("#5100 control (D-33): a second write in the same flush touching a held key inherits the hold on the unflushed carrier", async () => {
  const [src, setSrc] = createSignal({ a: 0, b: 0 });
  let releaseHold!: () => void;
  let releaseGuess!: () => void;
  let state!: { a: number; b: number };
  let setState!: any;
  let seen = { a: 0, b: 0 };
  const dispose = createRoot(dispose => {
    [state, setState] = createOptimisticStore(() => ({ ...src() }), { a: 0, b: 0 });
    createRenderEffect(
      () => ({ a: state.a, b: state.b }),
      v => {
        seen = v;
      }
    );
    return dispose;
  });
  flush();

  const holdA = action(function* () {
    setSrc({ a: 1, b: 0 });
    yield new Promise<void>(r => (releaseHold = r));
  });
  const guessBoth = action(function* () {
    setState((s: any) => {
      s.b = 99;
    });
    setState((s: any) => {
      s.a = 2;
    });
    yield new Promise<void>(r => (releaseGuess = r));
  });

  const doneHold = holdA();
  await tick();
  const doneGuess = guessBoth();
  await tick();
  expect(seen).toEqual({ a: 2, b: 99 });

  releaseGuess();
  await doneGuess;
  await tick();
  expect(seen).toEqual({ a: 2, b: 99 });

  releaseHold();
  await doneHold;
  await tick();
  expect(seen).toEqual({ a: 1, b: 0 });
  dispose();
});

test("#5100 control (D-33): single-write reuse of a live carrier adding a held key entangles without corrupting the lane", async () => {
  const [src, setSrc] = createSignal({ a: 0, b: 0 });
  let releaseHold!: () => void;
  let releaseG1!: () => void;
  let releaseG2!: () => void;
  let state!: { a: number; b: number };
  let setState!: any;
  let seen = { a: 0, b: 0 };
  const dispose = createRoot(dispose => {
    [state, setState] = createOptimisticStore(() => ({ ...src() }), { a: 0, b: 0 });
    createRenderEffect(
      () => ({ a: state.a, b: state.b }),
      v => {
        seen = v;
      }
    );
    return dispose;
  });
  flush();

  const holdA = action(function* () {
    setSrc({ a: 1, b: 0 });
    yield new Promise<void>(r => (releaseHold = r));
  });
  const guess1 = action(function* () {
    setState((s: any) => {
      s.b = 99;
    });
    yield new Promise<void>(r => (releaseG1 = r));
  });
  const guess2 = action(function* () {
    setState((s: any) => {
      s.b = 100;
      s.a = 2;
    });
    yield new Promise<void>(r => (releaseG2 = r));
  });

  const doneHold = holdA();
  await tick();
  const doneG1 = guess1();
  await tick();
  expect(seen).toEqual({ a: 0, b: 99 });

  const doneG2 = guess2();
  await tick();
  expect(seen).toEqual({ a: 2, b: 100 });

  releaseG1();
  releaseG2();
  await doneG1;
  await doneG2;
  await tick();
  // Entangled with `holdA` via `a`: stays on screen until `holdA` settles.
  expect(seen).toEqual({ a: 2, b: 100 });

  releaseHold();
  await doneHold;
  await tick();
  expect(seen).toEqual({ a: 1, b: 0 });
  dispose();
});

test("#5100 control (D-33): two-write reuse of a live carrier adding a held key entangles without corrupting the lane", async () => {
  const [src, setSrc] = createSignal({ a: 0, b: 0 });
  let releaseHold!: () => void;
  let releaseG1!: () => void;
  let releaseG2!: () => void;
  let state!: { a: number; b: number };
  let setState!: any;
  let seen = { a: 0, b: 0 };
  const dispose = createRoot(dispose => {
    [state, setState] = createOptimisticStore(() => ({ ...src() }), { a: 0, b: 0 });
    createRenderEffect(
      () => ({ a: state.a, b: state.b }),
      v => {
        seen = v;
      }
    );
    return dispose;
  });
  flush();

  const holdA = action(function* () {
    setSrc({ a: 1, b: 0 });
    yield new Promise<void>(r => (releaseHold = r));
  });
  const guess1 = action(function* () {
    setState((s: any) => {
      s.b = 99;
    });
    yield new Promise<void>(r => (releaseG1 = r));
  });
  const guess2 = action(function* () {
    setState((s: any) => {
      s.b = 100;
    });
    setState((s: any) => {
      s.a = 2;
    });
    yield new Promise<void>(r => (releaseG2 = r));
  });

  const doneHold = holdA();
  await tick();
  const doneG1 = guess1();
  await tick();
  expect(seen).toEqual({ a: 0, b: 99 });

  const doneG2 = guess2();
  await tick();
  expect(seen).toEqual({ a: 2, b: 100 });

  releaseG1();
  releaseG2();
  await doneG1;
  await doneG2;
  await tick();
  // Entangled with `holdA` via `a`: stays on screen until `holdA` settles.
  expect(seen).toEqual({ a: 2, b: 100 });

  releaseHold();
  await doneHold;
  await tick();
  expect(seen).toEqual({ a: 1, b: 0 });
  dispose();
});
