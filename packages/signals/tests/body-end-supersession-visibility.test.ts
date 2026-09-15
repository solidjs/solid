/**
 * A18 body-end corollary (#3427) — visibility during the correction window.
 *
 * When the action bodies have ended and nothing authoritative is in flight,
 * each override is superseded by the truth at hand — here the COMMITTED value,
 * since no landing staged anything. The window that follows must look like a
 * landing supersession to every reader: the display keeps the override until
 * the commit (A18 c), a fresh derivation is held (A29), and the verdict says
 * the truth differs (A18 d). Found by the visibility oracle: with nothing
 * staged the node carried no `_transition` stamp (an override written inside
 * an action never passes the adoption loop), so `supersededRead` served the
 * committed truth to a stale reader beside a display still showing the
 * override, a fresh memo published it, and `isPending` read false while
 * `latest` read the truth. Ownership for an override node is `_overrideOwner`
 * (#2912); the read path and the verdict now resolve it.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("A18 body-end supersession: the correction window", () => {
  it("display keeps the override, a stale re-run keeps it, a fresh derivation is held, the verdict says it differs", async () => {
    const flights: Array<() => void> = [];
    const [u, setU] = createSignal(0);
    const staleLog: number[] = [];
    let x!: () => number;
    let setX!: (v: number) => void;
    createRoot(() => {
      [x, setX] = createOptimistic(0);
      const downstream = createMemo(() => {
        const n = x();
        return new Promise<string>(r => flights.push(() => r(`${n}!`)));
      });
      createRenderEffect(downstream, () => {});
    });
    flush();
    flights.shift()!(); // prime downstream(0)
    await settle();
    // A pre-existing reader in another root (a sibling component), also
    // tracking an unrelated signal so it can be re-run mainline.
    createRoot(() => {
      createRenderEffect(
        () => {
          u();
          return x();
        },
        v => {
          staleLog.push(v);
        }
      );
    });
    flush();
    staleLog.length = 0;

    action(function* () {
      setX(1);
      yield Promise.resolve(); // the body ends; downstream(1) is still up
    })();
    flush();
    await settle();
    await settle();
    // Body-end: the override (1) is superseded by the committed truth (0); the
    // graph re-derives (a downstream flight for 0 starts) and the transaction
    // waits for it.
    expect(flights.length).toBe(2);
    expect(x()).toBe(1); // display
    expect(latest(x)).toBe(0); // truth
    expect(isPending(x)).toBe(true); // differs
    // (Reading the verdicts here is deliberate: a latest() pull once entered
    // the owning transaction ambiently and the two checks below depended on
    // whether latest() had been called first.)

    // A stale reader re-run by an unrelated write keeps displaying the override.
    setU(1);
    flush();
    expect(staleLog).toEqual([1]);

    // A fresh mainline derivation derives from the truth and is held.
    const fresh: number[] = [];
    createRoot(() => {
      const m = createMemo(() => x());
      createRenderEffect(m, v => {
        fresh.push(v);
      });
    });
    flush();
    expect(fresh).toEqual([]);

    // The 0-flight lands: the transaction commits, everything reveals at once.
    for (const f of flights.splice(0)) f();
    await settle();
    await settle();
    expect(x()).toBe(0);
    expect(isPending(x)).toBe(false);
    expect(fresh).toEqual([0]);
    expect(staleLog.at(-1)).toBe(0);
  });
});
