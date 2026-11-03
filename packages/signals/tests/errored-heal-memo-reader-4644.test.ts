import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

// #4644 (D-39, F-3, F-12): a fallback no live reader holds heals. The shape:
// `<Errored><Show when={page() === "list"} fallback="about">{X}</Show>
// </Errored>`, `rows` an async memo owned outside the boundary that rejects.
// X = "memo-only": `rows` is read only by memos (a `<Show when>` condition)
// whose value the boundary's tree flattens, so the reader the boundary
// caught is its own tree. X = "effect": a render effect in the branch reads
// it. Navigating away disposes every reader of `rows`: nothing on the new
// branch reads the error, so the boundary shows it, as a fresh render with
// the same inputs would. With another live reader of `rows` under the same
// boundary ("kept"), the error stays up.
const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const shape of ["memo-only", "effect", "kept"] as const)
  it(`${shape}: navigating away from a failed memo (#4644)`, async () => {
    let reject!: (e: Error) => void;
    const [page, setPage] = createSignal("list");
    const frames: unknown[] = [];
    const dispose = createRoot(d => {
      const rows = createMemo(
        () =>
          new Promise<number[]>((_, r) => {
            reject = r;
          })
      );
      const view = createErrorBoundary(
        () => {
          if (shape === "kept")
            createRenderEffect(
              () => rows().length,
              () => {}
            );
          const onList = createMemo(() => page() === "list");
          return createMemo(() => {
            if (!onList()) return "about";
            if (shape === "effect") {
              createRenderEffect(
                () => rows().length,
                () => {}
              );
              return "list";
            }
            const cond = createMemo(() => rows().length === 0);
            return createMemo(() => (cond() ? "none" : "some"));
          });
        },
        () => "ERR"
      );
      createRenderEffect(
        () => view(),
        v => {
          frames.push(v);
        }
      );
      return d;
    });
    flush();
    await tick();
    reject(new Error("boom"));
    await tick();
    expect(frames[frames.length - 1]).toBe("ERR");
    setPage("about");
    flush();
    await tick();
    dispose();
    expect(frames[frames.length - 1]).toBe(shape === "kept" ? "ERR" : "about");
  });

// The boundary waits on what threw only while a reader THAT CAUGHT ITS ERROR
// is alive (D-39). Something else still reading `rows` is not one: a memo
// hoisted outside the boundary, a derived store or projection built from it,
// a reader under another error boundary. Each still keeps `rows` subscribed,
// so "is `rows` read at all" kept this boundary stuck. While the list is
// mounted the error stays (across a prune: another reader's settling); away,
// the boundary heals; back, the error shows again (`sync`: a sync throw
// re-thrown by the new reader — an async source is re-asked on the new read
// instead, which is not this rule).
const flat = (v: unknown) => {
  while (typeof v === "function") v = v();
  return v;
};
for (const via of [
  "hoisted memo",
  "derived store",
  "projection",
  "other boundary",
  "sync"
] as const)
  it(`${via}: a reader outside the boundary does not keep its error up (#4644)`, async () => {
    let reject!: (e: Error) => void;
    let resolveP!: (v: number) => void;
    const [page, setPage] = createSignal("list");
    const [fail, setFail] = createSignal(false);
    const frames: unknown[] = [];
    const other: unknown[] = [];
    const dispose = createRoot(d => {
      const rows = createMemo(() => {
        if (via !== "sync") return new Promise<number[]>((_, r) => (reject = r));
        if (fail()) throw new Error("sync boom");
        return [] as number[];
      });
      let read: () => number[] = rows;
      if (via === "hoisted memo" || via === "sync") read = createMemo(() => [...rows()]);
      if (via === "derived store") {
        const [st] = createStore<{ list: number[] }>(
          dr => {
            dr.list = rows();
          },
          { list: [] }
        );
        read = () => st.list;
      }
      if (via === "projection") {
        const st = createProjection<{ list: number[] }>(
          dr => {
            dr.list = rows();
          },
          { list: [] }
        );
        read = () => st.list;
      }
      if (via === "other boundary") {
        const header = createErrorBoundary(
          () => createMemo(() => rows().length),
          () => "ERR2"
        );
        createRenderEffect(
          () => flat(header()),
          v => void other.push(v)
        );
      }
      const p = createMemo(() => new Promise<number>(r => (resolveP = r)));
      const view = createErrorBoundary(
        () => {
          createRenderEffect(
            () => p(),
            () => {}
          );
          const onList = createMemo(() => page() === "list");
          return createMemo(() => {
            if (!onList()) return "about";
            const cond = createMemo(() => read().length === 0);
            return createMemo(() => (cond() ? "none" : "some"));
          });
        },
        () => "ERR"
      );
      createRenderEffect(
        () => flat(view()),
        v => void frames.push(v)
      );
      return d;
    });
    const last = () => frames[frames.length - 1];
    flush();
    await tick();
    if (via === "sync") setFail(true);
    else reject(new Error("boom"));
    await tick();
    const failed = last();
    resolveP(1);
    await tick();
    const afterPrune = last();
    setPage("about");
    await tick();
    const away = last();
    setPage("list");
    await tick();
    const back = last();
    dispose();
    expect({ failed, afterPrune, away }).toEqual({
      failed: "ERR",
      afterPrune: "ERR",
      away: "about"
    });
    if (via === "sync") expect(back).toBe("ERR");
    if (via === "other boundary") expect(other[other.length - 1]).toBe("ERR2");
  });
