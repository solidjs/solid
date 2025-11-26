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
  type Owner,
  type Accessor,
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

  expect(o!._id).toEqual(undefined);
  expect(m!._id).toEqual(undefined);
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

  expect(o!._id).toEqual("");
  expect(m!._id).toEqual("0");
  expect(c!).toEqual("00");
  expect(m2!._id).toEqual("01");
  expect(r!._id).toEqual("1");
  expect(c2!).toEqual("010");
  expect(c3!).toEqual("011");
});
