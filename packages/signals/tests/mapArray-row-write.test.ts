// Row signals are written only when the row's own value differs from the new item.
import { afterEach, describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  type Accessor
} from "../src/index.js";
import { setWriteHook } from "../src/core/index.js";

interface Item {
  id: number;
  label: string;
}
const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, label: `r${i}` }));

const modes = [
  ["keyed by fn", { keyed: (r: Item) => r.id }],
  ["keyed: false", { keyed: false as const }]
] as const;

afterEach(() => setWriteHook(null));

function setup(initial: Item[], options: (typeof modes)[number][1]) {
  const [$src, setSrc] = createSignal(initial);
  const runs = new Map<number, number>();
  const dispose = createRoot(d => {
    const map = mapArray(
      $src,
      (row: Accessor<Item>) => {
        const id = row().id;
        createRenderEffect(
          () => row().label,
          () => void runs.set(id, (runs.get(id) ?? 0) + 1)
        );
        return row;
      },
      options
    );
    createRenderEffect(map, () => {});
    return d;
  });
  flush();
  return { setSrc, runs, dispose };
}

describe("mapArray row writes", () => {
  for (const [name, options] of modes) {
    it(`${name}: tail remove and append write no unchanged row`, () => {
      let list = items(50);
      const { setSrc, runs, dispose } = setup(list, options);
      const tail = list[49];
      let writes = 0;
      setWriteHook(() => writes++);
      list = list.slice(0, -1);
      setSrc(list);
      flush();
      list = [...list, tail];
      setSrc(list);
      flush();
      expect(writes).toBe(2); // the two list writes, no row write
      for (let i = 0; i < 49; i++) expect(runs.get(i)).toBe(1);
      dispose();
    });

    it(`${name}: a new object in an unchanged slot still reaches the row's readers`, () => {
      const list = items(5);
      const { setSrc, runs, dispose } = setup(list, options);
      const next = list.slice();
      next[0] = { id: 0, label: "first" };
      next[4] = { id: 4, label: "last" };
      setSrc(next);
      flush();
      expect(runs.get(0)).toBe(2);
      expect(runs.get(4)).toBe(2);
      for (let i = 1; i < 4; i++) expect(runs.get(i)).toBe(1);
      dispose();
    });
  }

  it("keyed by fn: head edits and a swap write no unchanged row in the suffix or window", () => {
    let list = items(50);
    const { setSrc, runs, dispose } = setup(list, modes[0][1]);
    const head = list[0];
    let writes = 0;
    setWriteHook(() => writes++);
    list = list.slice(1);
    setSrc(list);
    flush();
    list = [head, ...list];
    setSrc(list);
    flush();
    list = list.slice();
    [list[10], list[20]] = [list[20], list[10]];
    setSrc(list);
    flush();
    expect(writes).toBe(3); // the three list writes, no row write
    for (let i = 1; i < 50; i++) expect(runs.get(i)).toBe(1);
    dispose();
  });

  it("a row written by a suspended pass is written back when the list returns to `_items`", async () => {
    let resolve!: (v: string) => void;
    const gate = new Promise<string>(r => (resolve = r));
    const a = { id: 0, label: "a" };
    const b = { id: 1, label: "b" };
    const [$src, setSrc] = createSignal<Item[]>([a, b]);
    const [$useAsync, setUseAsync] = createSignal(false);
    let result = "";
    const dispose = createRoot(d => {
      const asyncVal = createMemo(async () => ($useAsync() ? gate : "sync"));
      const map = mapArray(
        $src,
        (row: Accessor<Item>) => {
          const x = row().id === 2 ? `x:${asyncVal()}` : undefined;
          return () => x ?? row().label;
        },
        { keyed: (r: Item) => r.id }
      );
      const view = createLoadingBoundary(
        () =>
          map()
            .map(r => r())
            .join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = view()),
        () => {}
      );
      return d;
    });
    flush();
    expect(result).toBe("a,b");

    // Row 0 takes `a2`, then the appended row suspends and aborts the pass.
    setUseAsync(true);
    setSrc([{ id: 0, label: "a2" }, b, { id: 2, label: "x" }]);
    flush();

    setSrc([a, b]);
    flush();
    expect(result).toBe("a,b");

    resolve("go");
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(result).toBe("a,b");
    dispose();
  });
});
