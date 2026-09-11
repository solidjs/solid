// #3283 (repro by @brenelz): deep()'s target walk bypasses the proxy traps and
// enumerated the pending backing with bare ownKeys. A plain-object overlay pb
// (Object.create(committed), own keys = this batch's writes) therefore hid
// every untouched child from the mid-flush re-walk — the effect's refreshed
// dependency set dropped those records, and later child edits never notified
// it. The walk now merges committed keys minus deletes, exactly like the
// ownKeys trap's #3044 overlay merge.
import {
  createRenderEffect,
  createRoot,
  createStore,
  deep,
  flush,
  untrack
} from "../../src/index.ts";

for (const editParent of [false, true]) {
  it(`deep remains subscribed to descendants after ${editParent ? "parent" : "child"} edit`, () => {
    let dispose!: () => void;
    const seen: { title: string; child: { count: number } }[] = [];
    const [store, setStore] = createRoot(d => {
      dispose = d;
      const pair = createStore({ title: "a", child: { count: 0 } });
      createRenderEffect(
        () => deep(pair[0]),
        value => {
          seen.push(value);
        }
      );
      return pair;
    });
    try {
      flush();
      setStore(draft => {
        if (editParent) draft.title = "b";
        else draft.child.count = 1;
      });
      flush();
      expect(seen.at(-1)).toEqual(
        editParent ? { title: "b", child: { count: 0 } } : { title: "a", child: { count: 1 } }
      );
      setStore(draft => {
        draft.child.count = 2;
      });
      flush();
      expect(untrack(() => store.child.count)).toBe(2);
      expect(seen.at(-1)?.child.count).toBe(2);
    } finally {
      dispose();
    }
  });
}

it("deep drops a deleted sibling from the re-walk but keeps the survivor subscribed", () => {
  let dispose!: () => void;
  const seen: { child?: { count: number }; doomed?: { gone: boolean } }[] = [];
  const [store, setStore] = createRoot(d => {
    dispose = d;
    const pair = createStore<{ child: { count: number }; doomed?: { gone: boolean } }>({
      child: { count: 0 },
      doomed: { gone: false }
    });
    createRenderEffect(
      () => deep(pair[0]),
      value => {
        seen.push(value);
      }
    );
    return pair;
  });
  try {
    flush();
    setStore(draft => {
      delete draft.doomed;
    });
    flush();
    expect(seen.at(-1)).toEqual({ child: { count: 0 } });
    setStore(draft => {
      draft.child.count = 1;
    });
    flush();
    expect(untrack(() => store.child.count)).toBe(1);
    expect(seen.at(-1)?.child?.count).toBe(1);
  } finally {
    dispose();
  }
});
