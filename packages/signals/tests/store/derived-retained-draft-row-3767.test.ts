/**
 * #3767 — a writable derived store whose derive returns one of its own draft
 * rows (`draft.filter(...)`) overflowed the stack once its source refreshed.
 * The row read through the draft is a draft WRAPPER (a proxy over a fake
 * target forwarding to the store proxy, projection.ts `wrapDraft`), not the
 * store's own proxy; reconcile took it for a foreign value and adopted it as
 * the row's backing, so the row's backing forwarded to the row itself.
 */
import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

type Row = { id: number; title: string; failed?: boolean };

describe("#3767 a derive retaining its own draft row", () => {
  it("keeps the row readable after the source refreshes", () => {
    const [source, setSource] = createSignal<Row[]>([{ id: 1, title: "server" }]);
    let rows!: Row[];
    let setRows!: (fn: (draft: Row[]) => Row[] | void) => void;
    const dispose = createRoot(d => {
      [rows, setRows] = createStore<Row[]>(
        draft => [...source(), ...draft.filter(row => row.failed)],
        []
      );
      return d;
    });
    flush();
    expect(rows.map(r => r.id)).toEqual([1]);

    setRows(draft => {
      draft.push({ id: 2, title: "local", failed: true });
    });
    flush();
    expect(rows.map(r => r.id)).toEqual([1, 2]);
    const local = rows[1];

    setSource([{ id: 1, title: "server" }]);
    flush();
    expect(rows.map(r => r.id)).toEqual([1, 2]);
    expect(Object.keys(rows[1])).toEqual(["id", "title", "failed"]);
    expect({ ...rows[1] }).toEqual({ id: 2, title: "local", failed: true });
    expect(rows[1]).toBe(local);

    setSource([{ id: 1, title: "server 2" }]);
    flush();
    expect(rows.map(r => r.title)).toEqual(["server 2", "local"]);
    expect(rows[1]).toBe(local);

    // The retained row is still the store's row: a write through the setter
    // lands, and the next derive keeps it.
    setRows(draft => {
      draft[1].title = "edited";
    });
    flush();
    expect(rows[1].title).toBe("edited");
    setSource([{ id: 1, title: "server 3" }]);
    flush();
    expect(rows.map(r => r.title)).toEqual(["server 3", "edited"]);
    expect(rows[1]).toBe(local);
    dispose();
  });

  it("re-renders a reader of the retained row", () => {
    const [source, setSource] = createSignal<Row[]>([{ id: 1, title: "server" }]);
    let rows!: Row[];
    let setRows!: (fn: (draft: Row[]) => Row[] | void) => void;
    const seen: string[][] = [];
    const dispose = createRoot(d => {
      [rows, setRows] = createStore<Row[]>(
        draft => [...source(), ...draft.filter(row => row.failed)],
        []
      );
      createRenderEffect(
        () => rows.map(r => r.title),
        titles => {
          seen.push(titles);
        }
      );
      return d;
    });
    flush();
    setRows(draft => {
      draft.push({ id: 2, title: "local", failed: true });
    });
    flush();
    setSource([{ id: 1, title: "server" }]);
    flush();
    setRows(draft => {
      draft[1].title = "edited";
    });
    flush();
    expect(seen).toEqual([["server"], ["server", "local"], ["server", "edited"]]);
    dispose();
  });

  it("retains a nested draft record of an object store", () => {
    type State = { server: string; local?: { note: string } };
    const [source, setSource] = createSignal("a");
    let state!: State;
    let setState!: (fn: (draft: State) => State | void) => void;
    const dispose = createRoot(d => {
      [state, setState] = createStore<State>(draft => ({ server: source(), local: draft.local }), {
        server: ""
      });
      return d;
    });
    flush();
    setState(draft => {
      draft.local = { note: "kept" };
    });
    flush();
    const local = state.local;
    setSource("b");
    flush();
    expect(state.server).toBe("b");
    expect({ ...state.local }).toEqual({ note: "kept" });
    expect(state.local).toBe(local);
    setSource("c");
    flush();
    expect({ ...state.local }).toEqual({ note: "kept" });
    dispose();
  });
});
