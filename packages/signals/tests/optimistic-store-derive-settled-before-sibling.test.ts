import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// One render effect reads a derived optimistic store over async memo `a`,
// async memo `b`, and a guess an action made. The action re-asks both; `a`
// answers first and `b` answers unchanged, so the effect never re-runs past
// `b`. The store's derive settles with `a`, and the effect, linked to the
// derive by the pass that saw its flight, must stop waiting on it: the change
// reveals once every flight has landed (F-2), and the guess ends with the
// hold it was made over (D-33).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each(["store", "signal"] as const)(
  "a guess beside an optimistic %s and a slower sibling flight lands when both answer",
  async kind => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = <T>(key: string) => new Promise<T>(res => asks.push({ key, res }));
    const answer = async (key: string, v: any) => {
      const i = asks.findIndex(q => q.key === key);
      expect(i).toBeGreaterThanOrEqual(0);
      asks.splice(i, 1)[0].res(v);
      await tick();
    };

    const [version, setVersion] = createSignal(0);
    const [status, setStatus] = createSignal("idle");
    const [revision, announce] = createSignal(0);
    let held: () => boolean = () => false;
    let screen = "";
    let shownStatus = "";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const a = createMemo(() => ask<{ id: string }[]>(`a:${version()}`));
      const b = createMemo(() => ask<number>(`b:${version()}`));
      let list: () => string;
      if (kind === "store") {
        const [rows] = createOptimisticStore(() => a().map(r => ({ ...r })), [], { key: "id" });
        list = () => rows.map(r => r.id).join();
      } else {
        const [rows] = createOptimistic(() => a());
        list = () =>
          rows()
            .map(r => r.id)
            .join();
      }
      createRenderEffect(
        () => `${list()}|${b()}|${(revision(), held())}`,
        v => {
          screen = v;
        }
      );
      createRenderEffect(status, v => {
        shownStatus = v;
      });
    });
    flush();
    await answer("a:0", [{ id: "a" }]);
    await answer("b:0", 2);
    expect(screen).toBe("a|2|false");

    let release!: () => void;
    const run = action(function* () {
      const [h, setH] = createOptimistic(false);
      setH(true);
      held = h;
      queueMicrotask(() => announce(n => n + 1));
      yield new Promise<void>(r => (release = r));
      setVersion(n => n + 1);
    });
    setStatus("submitting");
    const done = run();
    await tick();
    expect(screen).toBe("a|2|true");
    expect(shownStatus).toBe("idle");

    release();
    await tick();
    await answer("a:1", [{ id: "a" }]);
    await answer("b:1", 2);
    await done;
    await tick();

    expect(asks).toEqual([]);
    expect(screen).toBe("a|2|false");
    expect(shownStatus).toBe("submitting");
    dispose();
  }
);
