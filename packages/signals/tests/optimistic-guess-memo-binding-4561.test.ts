/**
 * #4561 (residue of #4536): a keyed optimistic store asked by `filter()`,
 * shown by split bindings — one render effect reads `filter()`, a second
 * reads a derivation of the list instead of the list directly: a memo
 * (`createMemo(() => issues.map(...))`), a `mapArray`, or `<For>`'s shape
 * (a `mapArray` whose rows have their own bindings). The filter changes by
 * a plain write and its frame is held on the new question; before that
 * question answers, an action guesses on the list (closes #1).
 *
 * The derivation is not a render effect and was not linked to the derive's
 * flight, so it was served the guess as standing in for the flight, stopped
 * waiting on it, and the list binding followed it out of the hold: the frame
 * committed `closed` beside the open answer's rows (F-1). A guess written
 * over a question in flight does not answer it (D-34 ¶3): the derivation,
 * part of the frame's hold, keeps observing the flight, so the screen keeps
 * the old input (with the guess) until the answer lands, then shows
 * `closed: [#2]` (the #4525 re-base); under `on` the boundary keeps its
 * fallback (D-14).
 */
import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
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

for (const shape of ["memo", "mapArray", "for"] as const)
  for (const on of [false, true])
    it(`#4561: a guess over a question in flight holds a ${shape} binding's frame (on=${on})`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const settle = async (key: string, v: any) => {
        const i = asks.findIndex(a => a.key === key);
        asks.splice(i, 1)[0].res(v);
        await tick();
      };
      let f = "",
        l = "",
        shown: unknown;
      const screen = () => (shown === "content" ? `${f}: ${l}` : shown);
      const seen: unknown[] = [];
      let setFilter!: (f: string) => void;
      let closeOne!: (id: number) => any;
      createRoot(() => {
        const [filter, sf] = createSignal("open");
        setFilter = sf;
        const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
          key: "id"
        });
        closeOne = action(function* (id: number) {
          set(list => {
            const i = list.findIndex(t => t.id === id);
            if (i >= 0) list.splice(i, 1);
          });
          yield ask(`close:${id}`);
          refresh(issues);
        });
        const out = createLoadingBoundary(
          () => {
            const list =
              shape === "memo"
                ? createMemo(() => issues.map((it: any) => `[#${it.id}]`).join(""))
                : (() => {
                    const rows = mapArray(
                      () => issues,
                      (it: any) => `[#${it.id}]`
                    );
                    return () => rows().join("");
                  })();
            if (shape === "for") {
              // <For>'s shape: the rows' own bindings read each row's leaves.
              const cells: Record<number, string> = {};
              const rows = mapArray(
                () => issues,
                (it: any) => {
                  const id = it.id;
                  createRenderEffect(
                    () => `[#${it.id}]`,
                    v => void (cells[id] = v)
                  );
                  return id;
                }
              );
              createRenderEffect(filter, v => void seen.push(screen(), (f = v)));
              createRenderEffect(
                () => rows(),
                ids =>
                  void seen.push(
                    screen(),
                    (l = ids.map((i: number) => cells[i] ?? `[#${i}]`).join(""))
                  )
              );
              return "content";
            }
            createRenderEffect(filter, v => void seen.push(screen(), (f = v)));
            createRenderEffect(list, v => void seen.push(screen(), (l = v)));
            return "content";
          },
          () => "loading",
          on ? { on: filter } : undefined
        );
        createRenderEffect(out, v => void (shown = v));
      });
      await tick();
      await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      expect(screen()).toBe("open: [#1][#3][#4]");
      setFilter("closed");
      await tick();
      expect(screen()).toBe(on ? "loading" : "open: [#1][#3][#4]");
      closeOne(1);
      await tick();
      // A whole frame: the old input with the guess (D-34 ¶3: however the
      // reads are grouped — a flat memo over every row too) — never the new
      // input beside the old answer's rows (F-1).
      if (on) expect(screen()).toBe("loading");
      else expect(screen()).toBe("open: [#3][#4]");
      await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
      expect(screen()).toBe("closed: [#2]");
      await settle("close:1", {});
      await settle("issues:closed", [{ id: 2 }]);
      expect(screen()).toBe("closed: [#2]");
      expect(asks).toEqual([]);
      seen.push(screen());
      expect(seen.filter(s => String(s).startsWith("closed") && /#3|#4/.test(String(s)))).toEqual(
        []
      );
    });

// Derivation chains between the list and its binding: the hold is judged
// through every hop (scheduler `blockedBy`'s frame readers, F-1).
for (const chain of ["memo-memo", "memo-memo-memo", "mapArray-memo"] as const)
  it(`#4561: a guess over a question in flight holds a ${chain} binding's frame`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const settle = async (key: string, v: any) => {
      asks
        .splice(
          asks.findIndex(a => a.key === key),
          1
        )[0]
        .res(v);
      await tick();
    };
    let f = "",
      l = "",
      shown: unknown;
    const screen = () => (shown === "content" ? `${f}: ${l}` : shown);
    const seen: unknown[] = [];
    let setFilter!: (f: string) => void, closeOne!: (id: number) => any;
    createRoot(() => {
      const [filter, sf] = createSignal("open");
      setFilter = sf;
      const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
        key: "id"
      });
      closeOne = action(function* (id: number) {
        set(
          list =>
            void list.splice(
              list.findIndex(t => t.id === id),
              1
            )
        );
        yield ask(`close:${id}`);
        refresh(issues);
      });
      const out = createLoadingBoundary(
        () => {
          let b: () => string;
          if (chain === "mapArray-memo") {
            const rows = mapArray(
              () => issues,
              (it: any) => `[#${it.id}]`
            );
            b = createMemo(() => rows().join(""));
          } else {
            const a = createMemo(() => issues.map((it: any) => `[#${it.id}]`).join(""));
            b = createMemo(() => a());
            if (chain === "memo-memo-memo") {
              const b0 = b;
              b = createMemo(() => b0());
            }
          }
          createRenderEffect(filter, v => void seen.push(screen(), (f = v)));
          createRenderEffect(b, v => void seen.push(screen(), (l = v)));
          return "content";
        },
        () => "loading"
      );
      createRenderEffect(out, v => void (shown = v));
    });
    await tick();
    await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
    setFilter("closed");
    await tick();
    expect(screen()).toBe("open: [#1][#3][#4]");
    closeOne(1);
    await tick();
    // The old input with the guess (D-34 ¶3), never `closed: [#3][#4]` (F-1).
    expect(screen()).toBe("open: [#3][#4]");
    await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
    expect(screen()).toBe("closed: [#2]");
    await settle("close:1", {});
    await settle("issues:closed", [{ id: 2 }]);
    expect(screen()).toBe("closed: [#2]");
    seen.push(screen());
    expect(seen.filter(s => String(s).startsWith("closed") && /#3|#4/.test(String(s)))).toEqual([]);
  });
