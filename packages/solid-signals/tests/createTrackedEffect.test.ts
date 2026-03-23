import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  onCleanup
} from "../src/index.js";

afterEach(() => flush());

it("should run effect", () => {
  const [$x, setX] = createSignal(0),
    effect = vi.fn($x);

  createRoot(() =>
    createTrackedEffect(() => {
      effect();
    })
  );
  expect(effect).toHaveBeenCalledTimes(0);
  flush();
  expect(effect).toHaveBeenCalledTimes(1);

  setX(1);
  flush();
  expect(effect).toHaveBeenCalledTimes(2);
});

it("should run effect on change", () => {
  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);

  const $a = createMemo(() => $x() + $y());
  const $b = createMemo(() => $a());

  const effect = vi.fn($b);

  createRoot(() =>
    createTrackedEffect(() => {
      effect();
    })
  );

  expect(effect).toHaveBeenCalledTimes(0);

  setX(20);
  flush();
  expect(effect).toHaveBeenCalledTimes(1);

  setY(20);
  flush();
  expect(effect).toHaveBeenCalledTimes(2);

  setX(20);
  setY(20);
  flush();
  expect(effect).toHaveBeenCalledTimes(2);
});

it("should stop effect", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn($x);

  const stopEffect = createRoot(dispose => {
    createTrackedEffect(() => {
      effect();
    });
    return dispose;
  });

  stopEffect();

  setX(20);
  flush();
  expect(effect).toHaveBeenCalledTimes(0);
});

it("should run all disposals before each new run", () => {
  const effect = vi.fn();
  const dispose = vi.fn();

  const [$x, setX] = createSignal(0);

  createRoot(() =>
    createTrackedEffect(() => {
      $x();
      effect();
      return dispose;
    })
  );
  flush();

  expect(effect).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(0);

  for (let i = 1; i <= 3; i += 1) {
    setX(i);
    flush();
    expect(effect).toHaveBeenCalledTimes(i + 1);
    expect(dispose).toHaveBeenCalledTimes(i);
  }
});

it("should conditionally observe", () => {
  const [$x, setX] = createSignal(0);
  const [$y, setY] = createSignal(0);
  const [$condition, setCondition] = createSignal(true);

  const $a = createMemo(() => ($condition() ? $x() : $y()));
  const effect = vi.fn($a);

  createRoot(() =>
    createTrackedEffect(() => {
      effect();
    })
  );
  flush();

  expect(effect).toHaveBeenCalledTimes(1);

  setY(1);
  flush();
  expect(effect).toHaveBeenCalledTimes(1);

  setX(1);
  flush();
  expect(effect).toHaveBeenCalledTimes(2);

  setCondition(false);
  flush();
  expect(effect).toHaveBeenCalledTimes(2);

  setY(2);
  flush();
  expect(effect).toHaveBeenCalledTimes(3);

  setX(3);
  flush();
  expect(effect).toHaveBeenCalledTimes(3);
});

it("should not warn on signal writes inside tracked effect", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const [$trigger, setTrigger] = createSignal(0);
  const [$target, setTarget] = createSignal(0);

  createRoot(() =>
    createTrackedEffect(() => {
      $trigger();
      setTarget(n => n + 1);
    })
  );
  flush();

  expect($target()).toBe(1);
  expect(warn).not.toHaveBeenCalled();

  setTrigger(1);
  flush();
  expect($target()).toBe(2);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it("should apply changes in effect in same flush", async () => {
  const [$x, setX] = createSignal(0),
    [$y, setY] = createSignal(0);

  const $a = createMemo(() => {
      return $x() + 1;
    }),
    $b = createMemo(() => {
      return $a() + 2;
    });

  createRoot(() =>
    createTrackedEffect(() => {
      $y();
      setX(n => n + 1);
    })
  );
  flush();

  expect($x()).toBe(1);
  expect($b()).toBe(4);
  expect($a()).toBe(2);

  setY(1);

  flush();

  expect($x()).toBe(2);
  expect($b()).toBe(5);
  expect($a()).toBe(3);

  setY(2);

  flush();

  expect($x()).toBe(3);
  expect($b()).toBe(6);
  expect($a()).toBe(4);
});

it("should run render effect before user effects", () => {
  const [$x, setX] = createSignal(0);

  let mark = "";
  createRoot(() => {
    createTrackedEffect(() => {
      $x();
      mark += "b";
    });
    createRenderEffect($x, () => {
      mark += "a";
    });
  });

  flush();
  expect(mark).toBe("ab");
  setX(1);
  flush();
  expect(mark).toBe("abab");
});

it("should throw when creating tracked-effect children inside (__DEV__ only)", () => {
  createRoot(() => {
    createTrackedEffect(() => {
      expect(() => createTrackedEffect(() => {})).toThrow(
        "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled"
      );
      expect(() => createMemo(() => 1)).toThrow(
        "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled"
      );
      expect(() => onCleanup(() => {})).toThrow(
        "Cannot use onCleanup inside createTrackedEffect or onSettled; return a cleanup function instead"
      );
    });
  });
  flush();
});

it("should throw uncaught tracked effect errors during flush", () => {
  createRoot(() => {
    createTrackedEffect(() => {
      throw new Error("tracked boom");
    });
  });

  expect(() => flush()).toThrow("tracked boom");
});

it("should throw on invalid cleanup values", () => {
  createRoot(() => {
    createTrackedEffect(() => ({}) as any);
  });

  expect(() => flush()).toThrow(
    "trackedEffect callback returned an invalid cleanup value. Return a cleanup function or undefined."
  );
});

it("should work with dynamic conditional tracking", () => {
  const [$type, setType] = createSignal<"a" | "b">("a");
  const [$valueA, setValueA] = createSignal("Alice");
  const [$valueB, setValueB] = createSignal("Bob");
  const log = vi.fn();

  createRoot(() => {
    createTrackedEffect(() => {
      if ($type() === "a") {
        log($valueA());
      } else {
        log($valueB());
      }
    });
  });

  flush();
  expect(log).toHaveBeenCalledWith("Alice");
  expect(log).toHaveBeenCalledTimes(1);

  // Changing valueB shouldn't trigger (not tracked when type is "a")
  setValueB("Bobby");
  flush();
  expect(log).toHaveBeenCalledTimes(1);

  // Changing type should trigger and now track valueB
  setType("b");
  flush();
  expect(log).toHaveBeenCalledWith("Bobby");
  expect(log).toHaveBeenCalledTimes(2);

  // Now changing valueA shouldn't trigger
  setValueA("Alicia");
  flush();
  expect(log).toHaveBeenCalledTimes(2);

  // But changing valueB should
  setValueB("Robert");
  flush();
  expect(log).toHaveBeenCalledWith("Robert");
  expect(log).toHaveBeenCalledTimes(3);
});
