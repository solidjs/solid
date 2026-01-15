import {
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh,
  isPending,
  NotReadyError
} from "../../src/index.js";

describe("Projection async behavior", () => {
  it("resolves async draft and transforms into new value", async () => {
    const [$x, setX] = createSignal(1);

    let runs = 0;
    let proj;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.value = v * 2;
          runs++;
        },
        { value: 0 }
      );
    });

    flush();
    expect(proj.value).toBe(0);
    await Promise.resolve();
    expect(proj.value).toBe(2);
    expect(runs).toBe(1);

    setX(2);
    flush();

    await Promise.resolve();
    expect(proj.value).toBe(4);
    expect(runs).toBe(2);
  });

  it("async projection preserves identity only for unchanged paths", async () => {
    const [$x, setX] = createSignal({ a: 1, b: 2 });

    let proj;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.a = v.a;
          draft.b = v.b;
        },
        { a: 0, b: 0 }
      );
    });

    flush();
    await Promise.resolve();

    const firstProj = proj;
    const firstA = proj.a;
    const firstB = proj.b;

    setX({ a: 1, b: 3 });
    flush();
    await Promise.resolve();

    expect(proj).toBe(firstProj);
    expect(proj.a).toBe(firstA);
    expect(proj.b).not.toBe(firstB);
  });

  it("async iterable projection yields multiple transformed snapshots", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* (draft) {
          draft.phase = "start";
          yield;

          await Promise.resolve();
          draft.phase = "middle";
          yield;

          await Promise.resolve();
          draft.phase = "end";
        },
        { phase: "init" }
      );
    });

    flush();
    expect(proj.phase).toBe("start");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.phase).toBe("middle");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.phase).toBe("end");
  });

  it("yielding a value replaces the entire snapshot (no merge)", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection<{ a: number; b: number; c?: number }>(
        async function* () {
          yield { a: 1, b: 2 };
        },
        { a: 0, b: 0, c: 99 }
      );
    });

    flush();
    expect(proj).toEqual({ a: 0, b: 0, c: 99 });

    await Promise.resolve();
    await Promise.resolve();

    // c disappears — no merging
    expect(proj).toEqual({ a: 1, b: 2 });
  });

  it("yielding multiple values transforms snapshot each time", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { a: 1 };
          yield { a: 2 };
          yield { a: 3 };
        },
        { a: 0 }
      );
    });

    flush();
    expect(proj.a).toBe(0);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(2);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(3);
  });

  it("yielded values preserve identity only for unchanged subtrees", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { nested: { x: 1, y: 2 } };
          yield { nested: { x: 1 } }; // y removed
        },
        { nested: { x: 0, y: 0 } }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstNested = proj.nested;
    const firstY = proj.nested.y;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.nested).not.toBe(firstNested);
    expect(proj.nested.x).toBe(1);
    expect(proj.nested.y).toBeUndefined();
    expect(firstY).toBe(2);
  });

  it("yielded values replace changed subtrees", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { nested: { x: 1, y: 2 } };
          yield { nested: { x: 10 } };
        },
        { nested: { x: 0, y: 0 } }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstNested = proj.nested;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.nested).not.toBe(firstNested);
    expect(proj.nested.x).toBe(10);
    expect(proj.nested.y).toBeUndefined();
  });

  it("shape changes DO NOT cause proxy identity changes", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { a: 1 };
          yield { a: 1, b: 2 }; // shape change
        },
        { a: 0 }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstProj = proj;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj).toBe(firstProj);
    expect(proj).toEqual({ a: 1, b: 2 });
  });

  it("keyed identity mismatch replaces subtree identity", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(async function* () {
        yield [{ id: 1, v: "a" }];
        yield [{ id: 2, v: "b" }]; // key changed → identity replaced
      }, []);
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstItem = proj[0];

    await Promise.resolve();
    await Promise.resolve();

    expect(proj[0]).not.toBe(firstItem); // key mismatch → identity replaced
    expect(proj[0]).toEqual({ id: 2, v: "b" });
  });

  it("async supersession ignores stale yielded values", async () => {
    const [$x, setX] = createSignal(1);

    let proj;
    let resolve1, resolve2;

    createRoot(() => {
      proj = createProjection<{ value: string | null }>(
        async function* () {
          const v = $x();
          if (v === 1) {
            await new Promise(r => (resolve1 = r));
            yield { value: "first" };
          } else {
            await new Promise(r => (resolve2 = r));
            yield { value: "second" };
          }
        },
        { value: null }
      );
    });

    flush();

    setX(2);
    flush();

    resolve1();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(null);

    resolve2();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("second");
  });

  it("async projection notifies only changed paths", async () => {
    const [$x, setX] = createSignal(1);

    let proj;
    let runs = 0,
      runs2 = 0;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.a = v;
          draft.b = 123;
        },
        { a: 0, b: 0 }
      );

      createRenderEffect(
        () => proj.a,
        () => {
          runs++;
        }
      );

      createRenderEffect(
        () => proj.b,
        () => {
          runs2++;
        }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(1);
    expect(runs2).toBe(1);

    setX(2);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    expect(runs2).toBe(1);

    setX(2);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    expect(runs2).toBe(1);
  });

  it("refresh() forces a new async run", async () => {
    let proj;
    let runs = 0;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = ++runs;
        },
        { value: 0 }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(1);

    refresh(proj);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(2);

    refresh(proj);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(3);
  });

  it("refresh() cancels in-flight yielded values", async () => {
    let proj;
    let resolve;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { value: "start" };
          await new Promise(r => (resolve = r));
          yield { value: "end" };
        },
        { value: "init" }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("start");

    refresh(proj);
    flush();

    resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe("start");
  });
});

describe.skip("Projection + transition behavior", () => {
  it("initial async run: not pending, reading throws NotReadyError, effects do not run until resolved", async () => {
    let proj;
    const effectFn = vi.fn();

    createRoot(() => {
      proj = createProjection(async draft => {
        await Promise.resolve();
        draft.value = 123;
      }, { value: 0 });

      createRenderEffect(
        () => proj.value,
        v => effectFn(v)
      );
    });

    flush();

    // initial load is NOT pending
    expect(isPending(() => proj.value)).toBe(false);

    // effect does NOT run yet (not deferred — simply not run because read throws)
    expect(effectFn).not.toHaveBeenCalled();

    // resolve async
    await Promise.resolve();
    await Promise.resolve();

    // effect runs after resolution
    expect(effectFn).toHaveBeenCalledWith(123);
  });

  it("second async run (update) enters pending=true until completion", async () => {
    const [$x, setX] = createSignal(1);
    let proj;

    createRoot(() => {
      proj = createProjection(async draft => {
        const v = $x();
        await Promise.resolve();
        draft.value = v * 10;
      }, { value: 0 });

      createRenderEffect(() => proj.value, () => {});
    });

    // initial load
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(10);
    expect(isPending(() => proj.value)).toBe(false);

    // update → enters pending
    setX(2);
    flush();
    expect(isPending(() => proj.value)).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe(20);
    expect(isPending(() => proj.value)).toBe(false);
  });

  it("supersession only applies to updates (not initial load)", async () => {
    const [$x, setX] = createSignal(1);

    let proj, resolve1, resolve2;

    createRoot(() => {
      proj = createProjection<{ value: string | null }>(async draft => {
        const v = $x();
        if (v === 1) {
          await new Promise(r => (resolve1 = r));
          draft.value = "first";
        } else {
          await new Promise(r => (resolve2 = r));
          draft.value = "second";
        }
      }, { value: null });
    });

    // initial load
    flush();
    expect(isPending(() => proj.value)).toBe(false);

    // resolve initial load
    resolve1();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("first");

    // update → enters pending
    setX(2);
    flush();
    expect(isPending(() => proj.value)).toBe(true);

    // supersede update
    resolve1(); // ignored
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("first");
    expect(isPending(() => proj.value)).toBe(true);

    resolve2(); // new run commits
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("second");
    expect(isPending(() => proj.value)).toBe(false);
  });

  it("refresh() always enters pending and cancels previous async run", async () => {
    let proj, resolve;

    createRoot(() => {
      proj = createProjection(async draft => {
        await new Promise(r => (resolve = r));
        draft.value = "done";
      }, { value: "init" });
    });

    // initial load
    flush();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("done");
    expect(isPending(() => proj.value)).toBe(false);

    // refresh → enters pending
    refresh(proj);
    flush();
    expect(isPending(() => proj.value)).toBe(true);

    // resolve old run (ignored)
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending(() => proj.value)).toBe(true);

    // allow new run to complete
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending(() => proj.value)).toBe(false);
  });

  it("effects inside transitions are deferred only on updates (not initial load)", async () => {
    let proj;
    const inside = vi.fn();
    const outside = vi.fn();

    createRoot(() => {
      proj = createProjection(async draft => {
        await Promise.resolve();
        draft.value = 1;
      }, { value: 0 });

      // inside transition
      createRenderEffect(
        () => proj.value,
        v => {
          if (isPending(() => proj.value)) inside(v);
        }
      );

      // outside transition
      createRenderEffect(
        () => proj.value,
        v => outside(v)
      );
    });

    // initial load
    flush();
    await Promise.resolve();
    await Promise.resolve();

    // initial load: not pending
    expect(isPending(() => proj.value)).toBe(false);

    // outside effect ran
    expect(outside).toHaveBeenCalledWith(1);

    // inside effect did NOT run (not pending)
    expect(inside).not.toHaveBeenCalled();

    // update → enters pending
    refresh(proj);
    flush();
    expect(isPending(() => proj.value)).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    // inside effect runs after pending resolves
    expect(inside).toHaveBeenCalled();
  });

  it("sync updates inside transitions are batched (only after initial load)", async () => {
    const [$x, setX] = createSignal(1);
    let proj;
    const effectFn = vi.fn();

    createRoot(() => {
      proj = createProjection(async draft => {
        const v = $x();
        await Promise.resolve();
        draft.value = v;
      }, { value: 0 });

      createRenderEffect(
        () => proj.value,
        v => effectFn(v)
      );
    });

    // initial load
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(effectFn).toHaveBeenCalledWith(1);

    // update → enters pending
    setX(2);
    flush();
    expect(isPending(() => proj.value)).toBe(true);

    // effect should NOT run yet
    expect(effectFn).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    // effect runs after pending resolves
    expect(effectFn).toHaveBeenCalledWith(2);
  });

  it("sync updates outside transitions are not batched", () => {
    const [$x, setX] = createSignal(1);
    let proj;
    const effectFn = vi.fn();

    createRoot(() => {
      proj = createProjection(draft => {
        draft.value = $x();
      }, { value: 0 });

      createRenderEffect(
        () => proj.value,
        v => effectFn(v)
      );
    });

    flush();
    expect(effectFn).toHaveBeenCalledWith(1);

    setX(2);
    flush();

    expect(effectFn).toHaveBeenCalledWith(2);
  });
});
