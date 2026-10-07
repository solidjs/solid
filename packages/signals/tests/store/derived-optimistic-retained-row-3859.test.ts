/**
 * #3859 — an optimistic store over a writable derived store whose derive
 * retains one of its own draft rows. After the source refreshed, the derived
 * store's committed array held the derive's draft wrapper (the #3767 alias)
 * for that row; the optimistic setter's draft wrapped it as a second row
 * target, so its write was a guess no reader of the view's row saw.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

type Row = { id: string; value: number };

describe("#3859 an optimistic write to a retained derived-store row", () => {
  it.each([
    ["the draft row", (rows: Row[]) => rows],
    ["a copy of the draft row", (rows: Row[]) => rows.map(row => ({ ...row }))]
  ])("shows while pending after a source refresh, retaining %s", async (_, retain) => {
    const [source, setSource] = createSignal<Row[]>([{ id: "server", value: 0 }]);
    let local!: Row[];
    let setLocal!: (fn: (draft: Row[]) => Row[] | void) => void;
    let view!: Row[];
    let setView!: (fn: (draft: Row[]) => Row[] | void) => void;
    let release!: () => void;
    let edit!: () => Promise<void>;
    const seen: (number | undefined)[] = [];
    const dispose = createRoot(d => {
      [local, setLocal] = createStore<Row[]>(
        draft => [...source(), ...retain(draft.filter(row => row.id === "local"))],
        []
      );
      [view, setView] = createOptimisticStore(local);
      createRenderEffect(
        () => view.find(row => row.id === "local")?.value,
        value => void seen.push(value)
      );
      edit = action(function* () {
        setView(draft => {
          draft.find(row => row.id === "local")!.value = 1;
        });
        yield new Promise<void>(resolve => (release = resolve));
      });
      return d;
    });
    flush();

    setLocal(draft => {
      draft.push({ id: "local", value: 0 });
    });
    flush();
    setSource([{ id: "server", value: 0 }]);
    flush();
    expect(view.map(row => row.id)).toEqual(["server", "local"]);
    expect(view[1].value).toBe(0);

    const done = edit();
    flush();
    expect(view[1].value).toBe(1);
    expect(seen.at(-1)).toBe(1);

    release();
    await done;
    flush();
    expect(view[1].value).toBe(0);
    expect(local[1].value).toBe(0);
    expect(seen).toEqual([undefined, 0, 1, 0]);
    dispose();
  });
});
