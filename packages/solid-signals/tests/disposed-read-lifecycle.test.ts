import { describe, expect, it } from "vitest";
import { createEffect, createMemo, createRoot, createSignal, flush } from "../src/index.js";

/**
 * Two disposal lifecycles (#3024):
 * - Observation-lifecycle nodes (unowned/lazy memos, CONFIG_AUTO_DISPOSE) go
 *   dormant when their last subscriber leaves; reads reawaken them.
 * - Owner-lifecycle nodes (derived-writable signals, owned memos' teardown)
 *   are dead once their owner disposes; reads return the last committed value
 *   and never re-run user code in the torn-down tree.
 */
describe("disposed reads: dormant vs dead (#3024)", () => {
  it("derived-writable signal retains a manual write after its owner is disposed (static source)", () => {
    let evals = 0;
    let sA!: () => number;
    let setA!: (v: number) => void;
    let dispose!: () => void;

    const propVal = 0; // static prop, no reactive deps

    createRoot(d => {
      dispose = d;
      [sA, setA] = createSignal<number>(() => {
        evals++;
        return propVal;
      });
      createEffect(
        () => sA(),
        () => {}
      );
    });
    flush();
    const evalsAfterMount = evals;

    setA(333);
    flush();
    expect(sA()).toBe(333);

    dispose();
    flush();
    expect(sA()).toBe(333); // dead: last committed value, not a re-derivation
    expect(evals).toBe(evalsAfterMount); // the source fn never re-ran
  });

  it("derived-writable signal retains a manual write after dispose (reactive source, unchanged)", () => {
    const [prop] = createSignal(0);
    let evals = 0;
    let sA!: () => number;
    let setA!: (v: number) => void;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      [sA, setA] = createSignal<number>(() => {
        evals++;
        return prop();
      });
      createEffect(
        () => sA(),
        () => {}
      );
    });
    flush();
    const evalsAfterMount = evals;

    setA(333);
    flush();
    expect(sA()).toBe(333);

    dispose();
    flush();
    expect(sA()).toBe(333);
    expect(evals).toBe(evalsAfterMount);
  });

  it("derived-writable signal freezes its derived value on dispose (no write ever made)", () => {
    const [prop, setProp] = createSignal(1);
    let evals = 0;
    let sA!: () => number;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      [sA] = createSignal<number>(() => {
        evals++;
        return prop();
      });
      createEffect(
        () => sA(),
        () => {}
      );
    });
    flush();
    expect(sA()).toBe(1);
    const evalsBefore = evals;

    dispose();
    flush();
    setProp(2);
    flush();
    expect(sA()).toBe(1); // dead: frozen at last committed value
    expect(evals).toBe(evalsBefore);
  });

  it("owned lazy memo is really dead after owner disposal: read freezes, no re-run", () => {
    const [count, setCount] = createSignal(1);
    let evals = 0;
    let doubled!: () => number;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      // Owned + lazy: carries AUTO_DISPOSE while alive, but owner death wins.
      doubled = createMemo(
        () => {
          evals++;
          return count() * 2;
        },
        { lazy: true }
      );
      createEffect(
        () => doubled(),
        () => {}
      );
    });
    flush();
    expect(doubled()).toBe(2);
    const evalsBefore = evals;

    dispose();
    flush();
    setCount(5);
    flush();
    expect(doubled()).toBe(2); // frozen at last committed value
    expect(evals).toBe(evalsBefore); // never re-ran in the torn-down tree
  });

  it("unowned memo stays dormant-reawakenable: reads after release recompute fresh", () => {
    const [count, setCount] = createSignal(1);
    let evals = 0;
    // Unowned memo: CONFIG_AUTO_DISPOSE, observation lifecycle.
    const doubled = createMemo(() => {
      evals++;
      return count() * 2;
    });

    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => doubled(),
        () => {}
      );
    });
    flush();
    const evalsObserved = evals;

    dispose(); // last subscriber leaves -> memo released to dormancy
    flush();

    setCount(5);
    flush();
    expect(doubled()).toBe(10); // reawakened with a fresh, correct value
    expect(evals).toBeGreaterThan(evalsObserved);
  });
});
