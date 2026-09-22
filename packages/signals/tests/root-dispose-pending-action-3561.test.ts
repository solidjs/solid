// #3561: disposing a root while an action is pending permanently skipped the
// cleanups of a memo branch's previous frame.
//
// A recompute under a held transaction parks the previous pass's children and
// `onCleanup`s as zombies on the owner's `_pendingFirstChild` /
// `_pendingDisposal` (#3404): the committed frame keeps rendering until the
// commit that retires it. The root's disposal walk only enumerates
// `_firstChild`, so it flagged the memo REACTIVE_DISPOSED without ever
// looking at the parked frame, and the commit's drain (`commitPendingNode` →
// `disposeChildren(memo, false, true)`) then returned on that very flag. The
// zombies stayed subscribed, kept their cleanups, and re-ran inside the
// torn-down tree once a later transaction drained the zombie heap.
//
// Owner disposal is death (#3024): the parked frame dies with its owner, on
// the death path only — a rerun's `disposeChildren(el)` must still leave the
// frame rendering until commit.

import {
  DEV,
  action,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  onCleanup
} from "../src/index.js";

afterEach(() => flush());

function setup() {
  const log: string[] = [];
  const counts = { frame: 0, child: 0, childRuns: 0 };
  let visible!: () => boolean;
  let setVisible!: (v: boolean) => void;
  let other!: () => number;
  let setOther!: (v: number) => void;
  let visibleNode!: any;
  let memoOwner!: any;

  const dispose = createRoot(release => {
    [visible, setVisible] = createSignal(true);
    [other, setOther] = createSignal(0);
    visibleNode = DEV!.getSignals(getOwner()!)[0];
    const branch = createMemo(() => {
      memoOwner = getOwner();
      if (!visible()) return false;
      onCleanup(() => {
        counts.frame++;
        log.push("frame cleanup");
      });
      createEffect(
        () => {
          counts.childRuns++;
          return visible();
        },
        () => () => {
          counts.child++;
          log.push("child cleanup");
        }
      );
      return true;
    });
    createEffect(branch, () => {});
    // `other` observed too, so an action writing only it still parks.
    createEffect(other, () => {});
    return release;
  });
  flush();

  const pending = Promise.withResolvers<void>();
  return {
    log,
    counts,
    dispose,
    setVisible,
    setOther,
    pending,
    observers: () => DEV!.getObservers(visibleNode).length,
    parked: () =>
      !!(memoOwner._x && (memoOwner._x._pendingFirstChild || memoOwner._x._pendingDisposal)),
    // the action's own staged write switches the branch; the memo's frame parks
    switchAction: () =>
      action(function* () {
        setVisible(false);
        yield pending.promise;
      })(),
    // an unrelated parked action — no branch switch
    otherAction: () =>
      action(function* () {
        setOther(1);
        yield pending.promise;
      })()
  };
}

describe("#3561 root disposal while an action is pending", () => {
  it("runs the parked frame's cleanups exactly once, at disposal", async () => {
    const s = setup();
    const changed = s.switchAction();
    flush();
    expect(s.parked()).toBe(true);
    expect(s.counts).toEqual({ frame: 0, child: 0, childRuns: 1 });

    s.dispose();
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
    expect(s.parked()).toBe(false);

    s.pending.resolve();
    await changed;
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
  });

  it("unsubscribes the zombies: a later write to their source does not rerun them", async () => {
    const s = setup();
    const changed = s.switchAction();
    flush();
    // the memo and the zombie child effect both read `visible`
    expect(s.observers()).toBe(2);

    s.dispose();
    flush();
    expect(s.observers()).toBe(0);

    s.pending.resolve();
    await changed;
    flush();
    // Resurrection path: with no transaction alive the zombie heap is not
    // drained; a later unrelated action plus a mainline write to `visible`
    // is what re-ran the leaked zombie in the torn-down tree.
    const second = Promise.withResolvers<void>();
    const [, setUnrelated] = createSignal(0);
    const p = action(function* () {
      setUnrelated(1);
      yield second.promise;
    })();
    flush();
    s.setVisible(true);
    flush();
    expect(s.counts.childRuns).toBe(1);
    expect(s.observers()).toBe(0);
    second.resolve();
    await p;
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
  });

  it("a write to the source between disposal and settle changes nothing", async () => {
    const s = setup();
    const changed = s.switchAction();
    flush();
    s.dispose();
    flush();
    s.setVisible(true);
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
    s.pending.resolve();
    await changed;
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
  });

  it("a plain child's cleanup was never affected (no branch switch)", async () => {
    const s = setup();
    const changed = s.otherAction();
    flush();
    expect(s.parked()).toBe(false);
    s.dispose();
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
    s.pending.resolve();
    await changed;
    flush();
    expect(s.counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
  });

  it("the parked frame unwinds too: children first, later registrations before earlier (#3572)", async () => {
    const log: string[] = [];
    let setVisible!: (v: boolean) => void;
    const pending = Promise.withResolvers<void>();
    const dispose = createRoot(release => {
      const [visible, sv] = createSignal(true);
      setVisible = sv;
      const branch = createMemo(() => {
        if (!visible()) {
          // the held pass registers its own cleanups and children (an
          // uncommitted effect never ran its effect phase, so its cleanup is
          // registered from the compute)
          onCleanup(() => log.push("held owner A"));
          createEffect(
            () => {
              onCleanup(() => log.push("held child"));
            },
            () => {}
          );
          onCleanup(() => log.push("held owner B"));
          return false;
        }
        onCleanup(() => log.push("frame owner A"));
        createEffect(
          () => {},
          () => () => log.push("frame child 1")
        );
        createEffect(
          () => {},
          () => () => log.push("frame child 2")
        );
        onCleanup(() => log.push("frame owner B"));
        return true;
      });
      createEffect(branch, () => {});
      onCleanup(() => log.push("root owner"));
      return release;
    });
    flush();
    const changed = action(function* () {
      setVisible(false);
      yield pending.promise;
    })();
    flush();
    expect(log).toEqual([]);

    dispose();
    flush();
    // The committed frame retires first — as the commit would have retired
    // it — then the held pass, then the root's own registrations. Within each
    // frame: children (newest first), then the owner's cleanups in unwind order.
    expect(log).toEqual([
      "frame child 2",
      "frame child 1",
      "frame owner B",
      "frame owner A",
      "held child",
      "held owner B",
      "held owner A",
      "root owner"
    ]);
    pending.resolve();
    await changed;
    flush();
    expect(log.length).toBe(8);
  });

  it("nested: a parked owner inside a parked owner drains both levels", async () => {
    const log: string[] = [];
    let innerRuns = 0;
    let setA!: (v: number) => void;
    let setVisible!: (v: boolean) => void;
    let visibleNode!: any;
    let outerOwner!: any;
    let innerOwner!: any;
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const dispose = createRoot(release => {
      const [a, sa] = createSignal(0);
      const [visible, sv] = createSignal(true);
      setA = sa;
      setVisible = sv;
      visibleNode = DEV!.getSignals(getOwner()!)[1];
      const outer = createMemo(() => {
        outerOwner = getOwner();
        const v = a();
        onCleanup(() => log.push(`outer a=${v}`));
        const inner = createMemo(() => {
          if (innerOwner === undefined) innerOwner = getOwner();
          if (!visible()) return false;
          onCleanup(() => log.push("inner frame"));
          createEffect(
            () => {
              innerRuns++;
              return visible();
            },
            () => () => log.push("inner child")
          );
          return true;
        });
        createEffect(inner, () => {});
        return v;
      });
      createEffect(outer, () => {});
      return release;
    });
    flush();
    // First action: the inner memo switches its branch and parks its frame.
    const p1 = action(function* () {
      setVisible(false);
      yield first.promise;
    })();
    flush();
    // Second action: the outer memo reruns and parks the (already parked)
    // inner memo as a zombie on its own frame; its held pass registers a
    // cleanup of its own and builds a fresh inner memo.
    const p2 = action(function* () {
      setA(1);
      yield second.promise;
    })();
    flush();
    expect(outerOwner._x._pendingFirstChild).not.toBeNull();
    expect(innerOwner._x._pendingFirstChild).not.toBeNull();
    expect(log).toEqual([]);
    expect(innerRuns).toBe(1);

    dispose();
    flush();
    // Unpatched, only the held pass's `outer a=1` ran: the frame's chain was
    // never walked, so the inner zombie memo stayed alive and subscribed and
    // its own parked frame drained late, at the first action's commit.
    expect(log).toEqual(["inner child", "inner frame", "outer a=0", "outer a=1"]);
    expect(DEV!.getObservers(visibleNode).length).toBe(0);

    first.resolve();
    second.resolve();
    await Promise.all([p1, p2]);
    flush();
    expect(log.length).toBe(4);
    expect(innerRuns).toBe(1);
  });

  it("a root parked as a zombie disposes itself once; the commit does not run it again", async () => {
    let frame = 0;
    let rootCleanups = 0;
    let disposeInner!: () => void;
    let setVisible!: (v: boolean) => void;
    const pending = Promise.withResolvers<void>();
    const dispose = createRoot(release => {
      const [visible, sv] = createSignal(true);
      setVisible = sv;
      const branch = createMemo(() => {
        if (!visible()) return false;
        onCleanup(() => frame++);
        createRoot(d => {
          disposeInner = d;
          onCleanup(() => rootCleanups++);
        });
        return true;
      });
      createEffect(branch, () => {});
      return release;
    });
    flush();
    const changed = action(function* () {
      setVisible(false);
      yield pending.promise;
    })();
    flush();
    expect({ frame, rootCleanups }).toEqual({ frame: 0, rootCleanups: 0 });

    // The inner root is a zombie on the memo's parked frame; disposing it
    // directly is death for it alone — the frame's own cleanup still waits.
    disposeInner();
    flush();
    expect({ frame, rootCleanups }).toEqual({ frame: 0, rootCleanups: 1 });

    pending.resolve();
    await changed;
    flush();
    expect({ frame, rootCleanups }).toEqual({ frame: 1, rootCleanups: 1 });
    dispose();
    expect({ frame, rootCleanups }).toEqual({ frame: 1, rootCleanups: 1 });
  });

  it("dormancy twin: a lazy memo losing its last subscriber mid-hold drains its frame too", async () => {
    const counts = { frame: 0, child: 0, childRuns: 0 };
    let setVisible!: (v: boolean) => void;
    let setWatch!: (v: boolean) => void;
    let visibleNode!: any;
    const pending = Promise.withResolvers<void>();
    const dispose = createRoot(release => {
      const [visible, sv] = createSignal(true);
      const [watch, sw] = createSignal(true);
      setVisible = sv;
      setWatch = sw;
      visibleNode = DEV!.getSignals(getOwner()!)[0];
      const branch = createMemo(
        () => {
          if (!visible()) return false;
          onCleanup(() => counts.frame++);
          createEffect(
            () => {
              counts.childRuns++;
              return visible();
            },
            () => () => counts.child++
          );
          return true;
        },
        { lazy: true }
      );
      createEffect(
        () => (watch() ? branch() : undefined),
        () => {}
      );
      return release;
    });
    flush();
    const changed = action(function* () {
      setVisible(false);
      yield pending.promise;
    })();
    flush();
    expect(DEV!.getObservers(visibleNode).length).toBe(2);

    // `unobserved()` → `disposeChildren(memo, true)`: the same death path.
    // Unpatched, the frame stayed parked forever — the later root disposal
    // returned on the DISPOSED flag dormancy had already set.
    setWatch(false);
    flush();
    expect(counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
    expect(DEV!.getObservers(visibleNode).length).toBe(0);

    pending.resolve();
    await changed;
    flush();
    dispose();
    flush();
    expect(counts).toEqual({ frame: 1, child: 1, childRuns: 1 });
    expect(DEV!.getObservers(visibleNode).length).toBe(0);
  });

  it("death only: a held rerun leaves the parked frame rendering until commit (#3404)", async () => {
    const counts = { frame: 0, child: 0, memoRuns: 0 };
    let setVisible!: (v: boolean) => void;
    let setTick!: (v: number) => void;
    let memoOwner!: any;
    const pending = Promise.withResolvers<void>();
    const dispose = createRoot(release => {
      const [visible, sv] = createSignal(true);
      const [tick, st] = createSignal(0);
      setVisible = sv;
      setTick = st;
      const branch = createMemo(() => {
        memoOwner = getOwner();
        counts.memoRuns++;
        tick();
        if (!visible()) return false;
        onCleanup(() => counts.frame++);
        createEffect(
          () => {},
          () => () => counts.child++
        );
        return true;
      });
      createEffect(branch, () => {});
      return release;
    });
    flush();
    const changed = action(function* () {
      setVisible(false);
      yield Promise.resolve();
      // a second staged write in a later step: the memo reruns under the
      // hold and its uncommitted pass's children die — the committed frame
      // must not
      setTick(1);
      yield pending.promise;
    })();
    flush();
    expect(counts.memoRuns).toBe(2);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
    // two held passes over the memo; the committed frame is still parked
    expect(counts).toEqual({ frame: 0, child: 0, memoRuns: 3 });
    expect(memoOwner._x._pendingFirstChild).not.toBeNull();

    pending.resolve();
    await changed;
    flush();
    expect(counts).toEqual({ frame: 1, child: 1, memoRuns: 3 });
    dispose();
    expect(counts).toEqual({ frame: 1, child: 1, memoRuns: 3 });
  });
});
