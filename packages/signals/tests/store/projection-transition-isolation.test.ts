/**
 * Transition isolation for projections (#3074, #3075).
 *
 * A projection derives from its sources, so its visibility rules must match
 * theirs on both sides of the commit boundary:
 *
 * - #3074: while a transition holds the commit, an untracked reader of a
 *   projected value must see the COMMITTED value after `flush()`, exactly
 *   like an untracked read of the source signal. The projection recomputes
 *   speculatively inside the transition, but that output is transition
 *   state — it must not be served as if committed.
 * - #3075: `latest()` must see the IN-FLIGHT value through a projection,
 *   exactly like it does through the source signal, a memo, or a derived
 *   signal.
 */
import {
  action,
  createEffect,
  createMemo,
  createProjection,
  createRoot,
  createSignal,
  flush,
  latest
} from "../../src/index.js";

afterEach(() => flush());

function holdTransition() {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const act = action(function* () {
    yield gate;
  });
  const done = act() as Promise<unknown>;
  return { release, done };
}

describe("projection transition isolation", () => {
  it("does not leak uncommitted state to untracked readers after flush (#3074)", async () => {
    const [count, setCount] = createSignal(0);
    let p!: { a?: number };
    const dispose = createRoot(d => {
      p = createProjection(() => ({ a: count() }), {});
      return d;
    });
    flush();
    expect(p.a).toBe(0);

    const { release, done } = holdTransition();

    setCount(v => v + 5);
    expect(p.a).toBe(0);
    expect(count()).toBe(0);

    flush();
    // the source stays committed for untracked readers...
    expect(count()).toBe(0);
    // ...and so must the projection of it
    expect(p.a).toBe(0);

    release();
    await done;
    flush();
    expect(count()).toBe(5);
    expect(p.a).toBe(5);
    dispose();
  });

  it("stays isolated when the projection is live (subscribed) too", async () => {
    const [count, setCount] = createSignal(0);
    const seen: (number | undefined)[] = [];
    let p!: { a?: number };
    const dispose = createRoot(d => {
      p = createProjection(() => ({ a: count() }), {});
      createEffect(
        () => p.a,
        v => {
          seen.push(v);
        }
      );
      return d;
    });
    flush();

    const { release, done } = holdTransition();
    setCount(v => v + 5);
    flush();
    expect(p.a).toBe(0);
    // the effect must not observe the speculative value while held
    expect(seen).toEqual([0]);

    release();
    await done;
    flush();
    expect(p.a).toBe(5);
    expect(seen).toEqual([0, 5]);
    dispose();
  });

  it("latest() reads the in-flight value through a projection (#3075)", () => {
    const [count, setCount] = createSignal(0);
    let p!: { a?: number };
    let m!: () => number;
    const dispose = createRoot(d => {
      p = createProjection(() => ({ a: count() }), {});
      m = createMemo(() => count());
      return d;
    });
    flush();
    expect(p.a).toBe(0);

    setCount(v => v + 5);

    // committed reads stay committed pre-flush
    expect(count()).toBe(0);
    expect(m()).toBe(0);
    expect(p.a).toBe(0);

    // latest() sees the in-flight value everywhere — projections included
    expect(latest(count)).toBe(5);
    expect(latest(m)).toBe(5);
    expect(latest(() => p.a)).toBe(5);
    dispose();
  });

  it("latest() reads the in-flight value through a projection inside a held transition", async () => {
    const [count, setCount] = createSignal(0);
    let p!: { a?: number };
    const dispose = createRoot(d => {
      p = createProjection(() => ({ a: count() }), {});
      return d;
    });
    flush();

    const { release, done } = holdTransition();
    setCount(v => v + 5);
    flush();

    expect(count()).toBe(0);
    expect(latest(count)).toBe(5);
    expect(latest(() => p.a)).toBe(5);

    release();
    await done;
    flush();
    expect(p.a).toBe(5);
    dispose();
  });
});
