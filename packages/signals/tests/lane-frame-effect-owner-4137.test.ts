/**
 * #4137, render-effect owner: the branch a lane pass withdraws is parked as a
 * lane frame whether its owner is a memo or a render effect (an `insert()`
 * hole runs inside a render effect). A memo owner carries the lane's value
 * (CONFIG_OVERRIDE); an effect has no lane value, so its lane membership is
 * its listing in the lane (`_x._transaction`). Either way the parked child
 * follows mainline writes only: the lane's own re-staging must not re-run it
 * on the condition the pass already withdrew.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function mount(read: () => string | undefined, stale: string[], log: string[]) {
  createRoot(() => {
    const value = createMemo(read);
    const condition = createMemo(value, { equals: (a: any, b: any) => !a === !b });
    let shown: any = false;
    createRenderEffect(
      () => {
        const c = condition();
        shown = c;
        if (!c) return "none";
        const child = createMemo(() => {
          if (!shown) stale.push(String(untrack(value)));
          return `${value()}`;
        });
        return child();
      },
      v => void log.push(v)
    );
  });
  flush();
}

describe("lane frame owned by a render effect (#4137)", () => {
  it("#4137: a branch withdrawn by its own lane under a render effect does not re-run", async () => {
    const log: string[] = [],
      stale: string[] = [];
    const [s, set] = createOptimisticStore<{ rows: Record<string, string> }>({ rows: {} });
    mount(() => s.rows.b, stale, log);
    let next!: () => void, done!: () => void;
    const g1 = new Promise<void>(r => (next = r)),
      g2 = new Promise<void>(r => (done = r));
    void action(function* () {
      set(d => {
        d.rows.b = "b";
      });
      yield g1;
      set(d => {
        delete d.rows.b;
      });
      yield g2;
    })();
    await tick();
    flush();
    expect(log.at(-1)).toBe("b");
    next();
    await tick();
    flush();
    expect(stale).toEqual([]);
    expect(log.at(-1)).toBe("none");
    done();
    await tick();
    flush();
    expect(stale).toEqual([]);
    expect(log.at(-1)).toBe("none");
  });

  it("#4137 control: the same shape on mainline writes", () => {
    const log: string[] = [],
      stale: string[] = [];
    const [b, setB] = createSignal<string | undefined>(undefined);
    mount(b, stale, log);
    setB("b");
    flush();
    setB(undefined);
    flush();
    expect({ stale, log }).toEqual({ stale: [], log: ["none", "b", "none"] });
  });
});
