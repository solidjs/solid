import {
  Computation,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flushSync,
  getOwner,
  onCleanup,
  Owner,
  type Accessor,
  type Signal
} from "../src/index.js";

afterEach(() => flushSync());

it("should dispose of inner computations", () => {
  let $x: Signal<number>;
  let $y: Accessor<number>;

  const memo = vi.fn(() => $x[0]() + 10);

  createRoot(dispose => {
    $x = createSignal(10);
    $y = createMemo(memo);
    $y();
    dispose();
  });

  // expect($y!).toThrow();
  expect(memo).toHaveBeenCalledTimes(1);

  flushSync();

  $x![1](50);
  flushSync();

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
  flushSync();

  expect(effect).toHaveBeenCalledWith(0, undefined);
  expect(effect).toHaveBeenCalledTimes(1);

  stopEffect();

  setX(10);
  flushSync();
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
  flushSync();
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
    const owner = getOwner() as Computation;
    expect(owner._sources).toBeUndefined();
    expect(owner._observers).toBeUndefined();
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
    })
    c();
  });

  expect(o!.id).toEqual(null);
  expect(m!.id).toEqual(null);
});

it("should generate ids if id is provided", () => {
  let o: Owner | null;
  let m: Owner | null;
  let m2: Owner | null;
  let r: Owner | null;

  createRoot(() => {
    o = getOwner();
    const c = createMemo(() => {
      m = getOwner();
      return createMemo(() => {
        m2 = getOwner();
      })
    })
    createRenderEffect(() => {
      r = getOwner();
      c()();
    }, () => {});
  }, { id: "s" });

  expect(o!.id).toEqual("s");
  expect(m!.id).toEqual("s0");
  expect(m2!.id).toEqual("s00");
  expect(r!.id).toEqual("s1");
});
