import { getNextChildId } from "../src/core/index.js";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  onCleanup,
  type Accessor,
  type Owner,
  type Signal
} from "../src/index.js";

afterEach(() => flush());

it("should dispose of inner computations", () => {
  let $x: Signal<number>;
  let $y: Accessor<number>;

  const memo = vi.fn(() => $x[0]() + 10);

  createRoot(dispose => {
    $x = createSignal(10);
    $y = createMemo(memo);
    dispose();
  });

  // expect($y!).toThrow();
  expect(memo).toHaveBeenCalledTimes(1);

  flush();

  $x![1](50);
  flush();

  // expect($y!).toThrow();
  expect(memo).toHaveBeenCalledTimes(1);
});

it("should return result", () => {
  const result = createRoot(dispose => {
    dispose();
    return 10;
  });

  expect(result).toBe(10);
});

it("should create new tracking scope", () => {
  const [$x, setX] = createSignal(0);
  const effect = vi.fn();

  const stopEffect = createRoot(dispose => {
    createEffect(
      () => {
        $x();
        createRoot(() => void createEffect($x, effect));
      },
      () => {}
    );

    return dispose;
  });
  flush();

  expect(effect).toHaveBeenCalledWith(0, undefined);
  expect(effect).toHaveBeenCalledTimes(1);

  stopEffect();

  setX(10);
  flush();
  expect(effect).not.toHaveBeenCalledWith(10);
  expect(effect).toHaveBeenCalledTimes(1);
});

it("should not be reactive", () => {
  let $x: Signal<number>;

  const root = vi.fn();

  createRoot(() => {
    $x = createSignal(0);
    $x[0]();
    root();
  });

  expect(root).toHaveBeenCalledTimes(1);

  $x![1](1);
  flush();
  expect(root).toHaveBeenCalledTimes(1);
});

it("should hold parent tracking", () => {
  createRoot(() => {
    const parent = getOwner();
    createRoot(() => {
      expect(getOwner()!._parent).toBe(parent);
    });
  });
});

it("should not observe", () => {
  const [$x] = createSignal(0);
  createRoot(() => {
    $x();
    const owner = getOwner() as Owner;
    expect((owner as any)._subs).toBeUndefined();
    expect((owner as any)._deps).toBeUndefined();
  });
});

it("should not throw if dispose called during active disposal process", () => {
  createRoot(dispose => {
    onCleanup(() => dispose());
    dispose();
  });
});

it("should not generate ids if no id is provided", () => {
  let o: Owner | null;
  let m: Owner | null;

  createRoot(() => {
    o = getOwner();
    const c = createMemo(() => {
      m = getOwner();
    });
    c();
  });

  expect(o!.id).toEqual(undefined);
  expect(m!.id).toEqual(undefined);
});

it("should generate ids if id is provided", () => {
  let o: Owner | null;
  let m: Owner | null;
  let m2: Owner | null;
  let c: string;
  let c2: string;
  let c3: string;
  let r: Owner | null;

  createRoot(
    () => {
      o = getOwner();
      const memo = createMemo(() => {
        m = getOwner()!;
        c = getNextChildId(m);
        return createMemo(() => {
          m2 = getOwner()!;
          c2 = getNextChildId(m2);
          c3 = getNextChildId(m2);
        });
      });
      createRenderEffect(
        () => {
          r = getOwner();
          memo()();
        },
        () => {}
      );
    },
    { id: "" }
  );

  expect(o!.id).toEqual("");
  expect(m!.id).toEqual("0");
  expect(c!).toEqual("00");
  expect(m2!.id).toEqual("01");
  expect(r!.id).toEqual("1");
  expect(c2!).toEqual("010");
  expect(c3!).toEqual("011");
});

it("should reset child ids when computations rerun", () => {
  const [$x, setX] = createSignal(0);
  const ids: string[][] = [];

  createRoot(
    () => {
      createMemo(() => {
        $x();
        const owner = getOwner()!;
        const run: string[] = [];
        run.push(
          createMemo(() => {
            return getOwner()!.id!;
          })()
        );
        run.push(
          createMemo(() => {
            return getOwner()!.id!;
          })()
        );
        ids.push(run);
      });
    },
    { id: "" }
  );

  expect(ids).toHaveLength(1);
  expect(ids[0]).toEqual(["00", "01"]);

  setX(1);
  flush();

  expect(ids).toHaveLength(2);
  expect(ids[1]).toEqual(["00", "01"]);
});

describe("transparent owners", () => {
  it("should not consume a _childCount slot from parent", () => {
    let siblingId: string | undefined;

    createRoot(
      () => {
        createRoot(() => {}, { transparent: true });
        const memo = createMemo(() => getOwner()!.id);
        siblingId = memo();
      },
      { id: "" }
    );

    expect(siblingId).toEqual("0");
  });

  it("should delegate child IDs to the nearest non-transparent ancestor", () => {
    let childA: string | undefined;
    let childB: string | undefined;

    createRoot(
      () => {
        createRoot(
          () => {
            childA = createMemo(() => getOwner()!.id)();
            childB = createMemo(() => getOwner()!.id)();
          },
          { transparent: true }
        );
      },
      { id: "" }
    );

    expect(childA).toEqual("0");
    expect(childB).toEqual("1");
  });

  it("should handle nested transparent owners delegating to non-transparent ancestor", () => {
    let childId: string | undefined;

    createRoot(
      () => {
        createRoot(
          () => {
            createRoot(
              () => {
                childId = createMemo(() => getOwner()!.id)();
              },
              { transparent: true }
            );
          },
          { transparent: true }
        );
      },
      { id: "" }
    );

    expect(childId).toEqual("0");
  });

  it("should not consume _childCount with transparent computed", () => {
    let siblingId: string | undefined;

    createRoot(
      () => {
        const transparentMemo = createMemo(() => {}, undefined, { transparent: true });
        transparentMemo();
        siblingId = createMemo(() => getOwner()!.id)();
      },
      { id: "" }
    );

    expect(siblingId).toEqual("0");
  });

  it("should delegate child IDs through transparent computed", () => {
    let childA: string | undefined;
    let childB: string | undefined;

    createRoot(
      () => {
        const transparentMemo = createMemo(
          () => {
            childA = createMemo(() => getOwner()!.id)();
            childB = createMemo(() => getOwner()!.id)();
          },
          undefined,
          { transparent: true }
        );
        transparentMemo();
      },
      { id: "" }
    );

    expect(childA).toEqual("0");
    expect(childB).toEqual("1");
  });

  it("should produce identical IDs with and without a transparent wrapper (devComponent scenario)", () => {
    const idsWithout: string[] = [];
    const idsWith: string[] = [];

    createRoot(
      () => {
        idsWithout.push(createMemo(() => getOwner()!.id!)());
        idsWithout.push(createMemo(() => getOwner()!.id!)());
      },
      { id: "" }
    );

    createRoot(
      () => {
        createRoot(
          () => {
            idsWith.push(createMemo(() => getOwner()!.id!)());
            idsWith.push(createMemo(() => getOwner()!.id!)());
          },
          { transparent: true }
        );
      },
      { id: "" }
    );

    expect(idsWith).toEqual(idsWithout);
  });

  it("should inherit parent id on the transparent owner itself", () => {
    let transparentOwner: Owner | null = null;
    let parentOwner: Owner | null = null;

    createRoot(
      () => {
        parentOwner = getOwner();
        createRoot(
          () => {
            transparentOwner = getOwner();
          },
          { transparent: true }
        );
      },
      { id: "" }
    );

    expect(parentOwner!.id).toEqual("");
    expect(transparentOwner!.id).toEqual("");
  });
});
