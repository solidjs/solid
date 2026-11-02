/**
 * A target's written keys chain across the setters of one batch; a setter
 * that wrote a single key leaves it bare, not in a set. When a descendant's
 * path copy privatizes the target mid-batch, the fold walks that chain to
 * merge every setter's writes onto the private backing.
 */
import { describe, expect, it } from "vitest";
import { createRoot, createStore, deep, flush, snapshot, untrack } from "../../src/index.js";

type Child = { id: number; selected: boolean };
type Row = { id: number; label: string; selected: boolean; children: Child[] };

const seed = (): Row[] => [
  { id: 1, label: "a", selected: true, children: [{ id: 11, selected: true }] }
];

function make() {
  return createRoot(() => {
    const handles = createStore(() => seed(), [] as Row[]);
    untrack(() => deep(handles[0]));
    return handles;
  });
}

const read = (store: any) => JSON.parse(JSON.stringify(snapshot(untrack(() => deep(store)))));

describe("written-key chain on a target privatized mid-batch", () => {
  it("a single-key setter behind a later setter commits", () => {
    const [store, setStore] = make();
    setStore(prev => {
      prev[0].children[0].selected = false;
    });
    setStore(prev => {
      prev[0].selected = false;
    });
    setStore(prev => {
      prev[0].label = "b";
    });
    flush();
    expect(read(store)).toEqual([
      { id: 1, label: "b", selected: false, children: [{ id: 11, selected: false }] }
    ]);
  });

  it("a chain of two sets ending in a bare key commits", () => {
    const [store, setStore] = make();
    setStore(prev => {
      prev[0].children[0].selected = false;
    });
    setStore(prev => {
      prev[0].selected = false;
    });
    setStore(prev => {
      delete (prev[0] as any).label;
    });
    setStore(prev => {
      prev[0].id = 2;
    });
    flush();
    expect(read(store)).toEqual([
      { id: 2, selected: false, children: [{ id: 11, selected: false }] }
    ]);
  });
});
