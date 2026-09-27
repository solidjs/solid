/**
 * #3672, revert side (§7b / O6): a chained optimistic store's nodes are
 * links — their `_value` is never served, the base's live value is. The
 * engine still consults that `_value` at two moments: optimisticWrite's
 * no-op check (the setter hands it the visible value at the write) and
 * resolveOptimisticNodes' notify compare at the revert. These specs pin the
 * second: when the base commits WHILE an override is active and the user
 * writes back to the pre-write value, the revert must still notify — the
 * truth differs from the guess. A `createMemo` reader is the witness: a
 * render effect off the lane is rescued by readsHeldCommitted's replay and
 * hides the miss.
 *
 * A `setBase` inside the action body is a transition-held write and never
 * commits mid-action, so the base is committed from OUTSIDE the action here.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function pending() {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
}

async function settleTicks() {
  flush();
  await tick();
  flush();
  await tick();
  flush();
}

describe("#3672 — chained optimistic store, revert compare against the base's live value", () => {
  it("memo: base confirms the guess while active, write back to the pre-write value, settle re-derives", async () => {
    const seen: number[] = [];
    const { setBase, base, view, setView, memo } = createRoot(() => {
      const [base, setBase] = createStore({ position: 0 });
      const [view, setView] = createOptimisticStore(base);
      const memo = createMemo(() => view.position * 10);
      createRenderEffect(
        () => memo(),
        v => {
          seen.push(v);
        }
      );
      return { setBase, base, view, setView, memo };
    });
    flush();
    expect(seen).toEqual([0]);

    const confirmed = pending();
    const gate = pending();
    const act = action(function* () {
      setView(d => {
        d.position = 1;
      });
      yield confirmed.promise;
      setView(d => {
        d.position = 0;
      });
      yield gate.promise;
    })();
    await settleTicks();
    expect(view.position).toBe(1);

    // the server confirms while the override is active
    setBase(d => {
      d.position = 1;
    });
    flush();
    confirmed.release();
    await settleTicks();
    expect(base.position).toBe(1);
    expect(view.position).toBe(0);
    expect(memo()).toBe(0);

    gate.release();
    await act;
    await settleTicks();
    expect(view.position).toBe(1);
    expect(memo()).toBe(10);
    expect(seen.at(-1)).toBe(10);
  });

  it("memo: base moved since creation, guess confirmed, write back to the pre-write value", async () => {
    const { setBase, base, view, setView, memo } = createRoot(() => {
      const [base, setBase] = createStore({ position: 0 });
      const [view, setView] = createOptimisticStore(base);
      const memo = createMemo(() => view.position * 10);
      createRenderEffect(
        () => memo(),
        () => {}
      );
      return { setBase, base, view, setView, memo };
    });
    flush();
    setBase(d => {
      d.position = 5;
    });
    flush();
    expect(memo()).toBe(50);

    const confirmed = pending();
    const gate = pending();
    const act = action(function* () {
      setView(d => {
        d.position = 7;
      });
      yield confirmed.promise;
      setView(d => {
        d.position = 5;
      });
      yield gate.promise;
    })();
    await settleTicks();
    expect(memo()).toBe(70);

    setBase(d => {
      d.position = 7;
    });
    flush();
    confirmed.release();
    await settleTicks();
    expect(base.position).toBe(7);
    expect(view.position).toBe(5);
    expect(memo()).toBe(50);

    gate.release();
    await act;
    await settleTicks();
    expect(view.position).toBe(7);
    expect(memo()).toBe(70);
  });

  it("memo: a confirmed guess settles without re-running its reader", async () => {
    let runs = 0;
    const { setBase, view, setView } = createRoot(() => {
      const [base, setBase] = createStore({ position: 0 });
      const [view, setView] = createOptimisticStore(base);
      const memo = createMemo(() => {
        runs++;
        return view.position;
      });
      createRenderEffect(
        () => memo(),
        () => {}
      );
      return { setBase, view, setView };
    });
    flush();

    const gate = pending();
    const act = action(function* () {
      setView(d => {
        d.position = 1;
      });
      yield gate.promise;
    })();
    await settleTicks();
    setBase(d => {
      d.position = 1;
    });
    await settleTicks();
    expect(view.position).toBe(1);
    const before = runs;

    gate.release();
    await act;
    await settleTicks();
    expect(view.position).toBe(1);
    // truth equals the guess: the revert compare is exact and notifies nobody
    expect(runs).toBe(before);
  });

  it("memo over presence: re-add a key, base deletes it while active, settle shows absent", async () => {
    const { setBase, base, view, setView, memo } = createRoot(() => {
      const [base, setBase] = createStore<{ tag?: string }>({ tag: "x" });
      const [view, setView] = createOptimisticStore(base);
      const memo = createMemo(() => ("tag" in view ? `has:${view.tag}` : "none"));
      createRenderEffect(
        () => memo(),
        () => {}
      );
      return { setBase, base, view, setView, memo };
    });
    flush();
    expect(memo()).toBe("has:x");

    const confirmed = pending();
    const gate = pending();
    const act = action(function* () {
      setView(d => {
        delete d.tag;
      });
      yield confirmed.promise;
      setView(d => {
        d.tag = "x";
      });
      yield gate.promise;
    })();
    await settleTicks();
    expect(memo()).toBe("none");

    setBase(d => {
      delete d.tag;
    });
    flush();
    confirmed.release();
    await settleTicks();
    expect("tag" in base).toBe(false);
    expect(memo()).toBe("has:x");

    gate.release();
    await act;
    await settleTicks();
    expect("tag" in view).toBe(false);
    expect(memo()).toBe("none");
  });

  it("memo over an array: push guess, base pops while active, write back the length, settle", async () => {
    const { setBase, base, view, setView, memo } = createRoot(() => {
      const [base, setBase] = createStore([{ id: "a" }, { id: "b" }]);
      const [view, setView] = createOptimisticStore(base);
      const memo = createMemo(() => view.map(r => r.id).join() + "|" + view.length);
      createRenderEffect(
        () => memo(),
        () => {}
      );
      return { setBase, base, view, setView, memo };
    });
    flush();
    expect(memo()).toBe("a,b|2");

    const confirmed = pending();
    const gate = pending();
    const act = action(function* () {
      setView(d => {
        d.push({ id: "c" });
      });
      yield confirmed.promise;
      setView(d => {
        d.pop();
      });
      yield gate.promise;
    })();
    await settleTicks();
    expect(memo()).toBe("a,b,c|3");

    setBase(d => {
      d.pop();
    });
    flush();
    confirmed.release();
    await settleTicks();
    expect(base.length).toBe(1);
    // the composed view is base [a] + the length guess: slot 1 is a hole now
    expect(view.length).toBe(2);
    expect(view[0].id).toBe("a");

    gate.release();
    await act;
    await settleTicks();
    expect(view.length).toBe(1);
    expect(memo()).toBe("a|1");
  });

  it("memo: chained over chained, write back to the base's previous value after a confirm", async () => {
    const { setBase, outer, setOuter, middle, memo } = createRoot(() => {
      const [base, setBase] = createStore({ position: 0 });
      const [middle] = createOptimisticStore(base);
      const [outer, setOuter] = createOptimisticStore(middle);
      const memo = createMemo(() => outer.position * 10);
      createRenderEffect(
        () => memo(),
        () => {}
      );
      return { setBase, outer, setOuter, middle, memo };
    });
    flush();
    setBase(d => {
      d.position = 1;
    });
    flush();
    expect(memo()).toBe(10);

    const gate = pending();
    const act = action(function* () {
      setOuter(d => {
        d.position = 0;
      });
      yield gate.promise;
    })();
    await settleTicks();
    expect(outer.position).toBe(0);
    expect(middle.position).toBe(1);
    expect(memo()).toBe(0);

    gate.release();
    await act;
    await settleTicks();
    expect(outer.position).toBe(1);
    expect(memo()).toBe(10);
  });
});
