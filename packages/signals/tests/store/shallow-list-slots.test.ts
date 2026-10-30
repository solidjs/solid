/**
 * `mapArray` over a shallow store diffs the store's backing (types.ts
 * `shallowView`) instead of reading every slot through the proxy. A shallow
 * store's slots are raw records, so the backing the container read serves is
 * what each slot read would serve; these pin that the list sees the same
 * frame either way: plain writes, structure changes, a positional refetch, a
 * write held by an action, and a shallow projection's derive.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  reconcile
} from "../../src/index.js";

afterEach(() => flush());

type Row = { id: number; label: string };
const rows = (n: number, tag = "") =>
  Array.from({ length: n }, (_, i): Row => ({ id: i, label: `r${i}${tag}` }));

function mount(list: () => Row[]) {
  let mounts = 0;
  let screen: string[] = [];
  const dispose = createRoot(d => {
    const mapped = createMemo(
      mapArray(
        list,
        (row: () => Row) => {
          mounts++;
          return () => row().label;
        },
        { keyed: (r: Row) => r.id }
      )
    );
    createRenderEffect(
      () => mapped().map(read => read()),
      v => {
        screen = v;
      }
    );
    return d;
  });
  flush();
  return { screen: () => screen, mounts: () => mounts, dispose };
}

describe("mapArray over a shallow store", () => {
  it("follows slot writes, structure changes and refetches by key", () => {
    const [s, set] = createStore(rows(3), { shallow: true });
    const view = mount(() => s);
    expect(view.screen()).toEqual(["r0", "r1", "r2"]);

    set(d => {
      d[1] = { ...d[1], label: "edited" };
    });
    flush();
    expect(view.screen()).toEqual(["r0", "edited", "r2"]);
    expect(view.mounts()).toBe(3);

    set(d => {
      d.push({ id: 3, label: "r3" });
    });
    flush();
    expect(view.screen()).toEqual(["r0", "edited", "r2", "r3"]);
    expect(view.mounts()).toBe(4);

    set(d => d.filter(r => r.id !== 0));
    flush();
    expect(view.screen()).toEqual(["edited", "r2", "r3"]);

    set(reconcile(rows(4, "!").slice(1), null));
    flush();
    expect(view.screen()).toEqual(["r1!", "r2!", "r3!"]);
    expect(view.mounts()).toBe(4);
    view.dispose();
  });

  it("shows the committed rows while an action holds the write", async () => {
    const [s, set] = createStore(rows(2), { shallow: true });
    const view = mount(() => s);
    let finish!: () => void;
    const run = action(function* () {
      set(d => {
        d[0] = { id: 0, label: "held" };
        d.push({ id: 2, label: "new" });
      });
      yield new Promise<void>(r => (finish = r));
    });
    const done = run();
    flush();
    expect(view.screen()).toEqual(["r0", "r1"]);
    finish();
    await done;
    flush();
    expect(view.screen()).toEqual(["held", "r1", "new"]);
    view.dispose();
  });

  it("reads a shallow projection's derived rows", () => {
    const [n, setN] = createSignal(2);
    let view!: ReturnType<typeof mount>;
    const dispose = createRoot(d => {
      const p = createProjection<Row[]>(
        draft => {
          draft.length = 0;
          for (const r of rows(n(), `@${n()}`)) draft.push(r);
        },
        [],
        { shallow: true }
      );
      view = mount(() => p);
      return d;
    });
    expect(view.screen()).toEqual(["r0@2", "r1@2"]);
    setN(3);
    flush();
    expect(view.screen()).toEqual(["r0@3", "r1@3", "r2@3"]);
    view.dispose();
    dispose();
  });
});
