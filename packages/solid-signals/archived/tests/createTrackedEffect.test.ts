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

  expect(effect).to.toHaveBeenCalledTimes(0);

  setX(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(1);

  setY(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);

  setX(20);
  setY(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should handle nested effect", () => {
  const [$x, setX] = createSignal(0);
  const [$y, setY] = createSignal(0);

  const outerEffect = vi.fn();
  const innerEffect = vi.fn();
  const innerPureDispose = vi.fn();
  const innerEffectDispose = vi.fn();

  const stopEffect = createRoot(dispose => {
    createTrackedEffect(() => {
      $x();
      createTrackedEffect(() => {
        $y();
        innerEffect();
        onCleanup(innerPureDispose);
        return () => {
          innerEffectDispose();
        };
      });
      outerEffect();
    });

    return dispose;
  });

  flush();
  expect(outerEffect).toHaveBeenCalledTimes(1);
  expect(innerEffect).toHaveBeenCalledTimes(1);
  expect(innerPureDispose).toHaveBeenCalledTimes(0);
  expect(innerEffectDispose).toHaveBeenCalledTimes(0);

  setY(1);
  flush();
  expect(outerEffect).toHaveBeenCalledTimes(1);
  expect(innerEffect).toHaveBeenCalledTimes(2);
  expect(innerPureDispose).toHaveBeenCalledTimes(1);
  expect(innerEffectDispose).toHaveBeenCalledTimes(1);

  setY(2);
  flush();
  expect(outerEffect).toHaveBeenCalledTimes(1);
  expect(innerEffect).toHaveBeenCalledTimes(3);
  expect(innerPureDispose).toHaveBeenCalledTimes(2);
  expect(innerEffectDispose).toHaveBeenCalledTimes(2);

  innerEffect.mockReset();
  innerPureDispose.mockReset();
  innerEffectDispose.mockReset();

  setX(1);
  flush();
  expect(outerEffect).toHaveBeenCalledTimes(2);
  expect(innerEffect).toHaveBeenCalledTimes(1); // new one is created
  expect(innerPureDispose).toHaveBeenCalledTimes(1);
  expect(innerEffectDispose).toHaveBeenCalledTimes(1);

  setY(3);
  flush();
  expect(outerEffect).toHaveBeenCalledTimes(2);
  expect(innerEffect).toHaveBeenCalledTimes(2);
  expect(innerPureDispose).toHaveBeenCalledTimes(2);
  expect(innerEffectDispose).toHaveBeenCalledTimes(2);

  stopEffect();
  setX(10);
  setY(10);
  expect(outerEffect).toHaveBeenCalledTimes(2);
  expect(innerEffect).toHaveBeenCalledTimes(2);
  expect(innerPureDispose).toHaveBeenCalledTimes(3);
  expect(innerEffectDispose).toHaveBeenCalledTimes(3);
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
  const disposeA = vi.fn();
  const disposeB = vi.fn();
  const disposeC = vi.fn();

  function fnA() {
    onCleanup(disposeA);
  }

  function fnB() {
    onCleanup(disposeB);
  }

  const [$x, setX] = createSignal(0);

  createRoot(() =>
    createTrackedEffect(() => {
      fnA(), fnB();
      $x();
      effect();
      return disposeC;
    })
  );
  flush();

  expect(effect).toHaveBeenCalledTimes(1);
  expect(disposeA).toHaveBeenCalledTimes(0);
  expect(disposeB).toHaveBeenCalledTimes(0);
  expect(disposeC).toHaveBeenCalledTimes(0);

  for (let i = 1; i <= 3; i += 1) {
    setX(i);
    flush();
    expect(effect).toHaveBeenCalledTimes(i + 1);
    expect(disposeA).toHaveBeenCalledTimes(i);
    expect(disposeB).toHaveBeenCalledTimes(i);
    expect(disposeC).toHaveBeenCalledTimes(i);
  }
});

it("should dispose of nested effect", () => {
  const [$x, setX] = createSignal(0);
  const innerEffect = vi.fn($x);

  const stopEffect = createRoot(dispose => {
    createTrackedEffect(() => {
      createTrackedEffect(() => {
        innerEffect();
      });
    });

    return dispose;
  });

  stopEffect();

  setX(10);
  flush();
  expect(innerEffect).toHaveBeenCalledTimes(0);
  expect(innerEffect).not.toHaveBeenCalledWith(10);
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

it("should dispose of nested conditional effect", () => {
  const [$condition, setCondition] = createSignal(true);

  const disposeA = vi.fn();
  const disposeB = vi.fn();

  function fnA() {
    createTrackedEffect(() => {
      return disposeA;
    });
  }

  function fnB() {
    createTrackedEffect(() => {
      return disposeB;
    });
  }

  createRoot(() => createTrackedEffect(() => ($condition() ? fnA() : fnB())));
  flush();
  setCondition(false);
  flush();
  expect(disposeA).toHaveBeenCalledTimes(1);
});

// https://github.com/preactjs/signals/issues/152
it("should handle looped effects", () => {
  let values: number[] = [],
    loop = 2;

  const [$value, setValue] = createSignal(0);

  let x = 0;
  createRoot(() =>
    createTrackedEffect(() => {
      x++;
      values.push($value());
      for (let i = 0; i < loop; i++) {
        createTrackedEffect(() => {
          values.push($value() + i);
        });
      }
    })
  );

  flush();

  expect(values).toHaveLength(3);
  expect(values.join(",")).toBe("0,0,1");

  loop = 1;
  values = [];
  setValue(1);
  flush();

  expect(values).toHaveLength(2);
  expect(values.join(",")).toBe("1,1");

  values = [];
  setValue(2);
  flush();

  expect(values).toHaveLength(2);
  expect(values.join(",")).toBe("2,2");
});

it("should apply changes in effect in same flush", async () => {
  const [$x, setX] = createSignal(0, { pureWrite: true }),
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

it("should run parent effect before child effect", () => {
  const [$x, setX] = createSignal(0);
  const $condition = createMemo(() => $x());

  let calls = 0;

  createRoot(() =>
    createTrackedEffect(() => {
      createTrackedEffect(() => {
        $x();
        calls++;
      });
      $condition();
    })
  );
  flush();
  expect(calls).toBe(1);
  setX(1);
  flush();
  expect(calls).toBe(2);
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
