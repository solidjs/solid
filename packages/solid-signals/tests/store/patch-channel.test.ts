import { describe, expect, it } from "vitest";
import {
  action,
  createRoot,
  createStore,
  flush,
  reconcile,
  registerPatch
} from "../../src/index.js";

describe("patch channel (PR-A)", () => {
  it("setter write applies the patch at flush, not at write time", () => {
    const [state, setState] = createStore({ user: { name: "a", title: "x" } });
    const log: string[] = [];
    registerPatch(state.user, (next: any, prev: any, force?: boolean) => {
      log.push((force ? "F:" : "") + prev?.name + "->" + next.name);
    });
    setState(s => {
      s.user.name = "b";
    });
    // Effect-phase timing: nothing applied inside the batch window.
    expect(log).toEqual([]);
    flush();
    expect(log.length).toBe(1);
    expect(log[0].endsWith("->b")).toBe(true);
  });

  it("reconcile applies the patch with (incoming, pre-adopt prev)", () => {
    const [state, setState] = createStore({ rows: [{ id: 1, count: 5 }] });
    const log: string[] = [];
    registerPatch(state.rows[0], (next: any, prev: any) => {
      log.push(prev.count + "->" + next.count);
    });
    setState(s => {
      reconcile([{ id: 1, count: 9 }], "id")(s.rows);
    });
    flush();
    expect(log).toEqual(["5->9"]);
  });

  it("targeted nested write bubbles to the ancestor patch as a forced re-apply", () => {
    const [state, setState] = createStore({
      rows: [{ id: 1, count: 1, queries: [{ elapsed: "1" }] }]
    });
    const log: Array<[boolean | undefined, string]> = [];
    registerPatch(state.rows[0], (next: any, prev: any, force?: boolean) => {
      log.push([force, next.queries[0].elapsed]);
    });
    // Touch the nested record through the draft so it has its own target,
    // then write it directly — the row patch must still hear about it.
    setState(s => {
      s.rows[0].queries[0].elapsed = "2";
    });
    flush();
    expect(log.length).toBe(1);
    expect(log[0][0]).toBe(true); // forced (ancestor bubble)
    expect(log[0][1]).toBe("2");
  });

  it("unbind stops dispatch; multi-consumer keeps the other", () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const a: string[] = [];
    const b: string[] = [];
    const unbindA = registerPatch(state.user, (n: any) => a.push(n.name));
    registerPatch(state.user, (n: any) => b.push(n.name));
    unbindA();
    setState(s => {
      s.user.name = "z";
    });
    flush();
    expect(a).toEqual([]);
    expect(b).toEqual(["z"]);
  });

  it("transition-held write does NOT apply until the transition commits", async () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    registerPatch(state.user, (next: any) => log.push(next.name));
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = action(function* () {
        setState(s => {
          s.user.name = "held";
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save();
    flush();
    // The write rides the action's transition: not visible, not patched.
    expect(log).toEqual([]);
    resolve();
    await p;
    flush();
    // Transition committed: the patch applies with the landed value.
    expect(log).toEqual(["held"]);
  });

  it("disposed owner drops its patches mid-flight", () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.user, (n: any) => log.push(n.name));
    });
    setState(s => {
      s.user.name = "b";
    });
    dispose();
    flush();
    expect(log).toEqual([]);
  });
});
