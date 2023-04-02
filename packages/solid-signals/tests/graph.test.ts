// https://github.com/preactjs/signals/blob/main/packages/core/test/signal.test.tsx#L1249

import { createMemo, createSignal } from "../src";

it("should drop X->B->X updates", () => {
  //     X
  //   / |
  //  A  | <- Looks like a flag doesn't it? :D
  //   \ |
  //     B
  //     |
  //     C

  const [$x, setX] = createSignal(2);

  const $a = createMemo(() => $x() - 1);
  const $b = createMemo(() => $x() + $a());

  const compute = vi.fn(() => "c: " + $b());
  const $c = createMemo(compute);

  expect($c()).toBe("c: 3");
  expect(compute).toHaveBeenCalledTimes(1);
  compute.mockReset();

  setX(4);
  $c();
  expect(compute).toHaveBeenCalledTimes(1);
});

it("should only update every signal once (diamond graph)", () => {
  // In this scenario "D" should only update once when "A" receive an update. This is sometimes
  // referred to as the "diamond" scenario.
  //     X
  //   /   \
  //  A     B
  //   \   /
  //     C

  const [$x, setX] = createSignal("a");
  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());

  const spy = vi.fn(() => $a() + " " + $b());
  const $c = createMemo(spy);

  expect($c()).toBe("a a");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($c()).toBe("aa aa");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should only update every signal once (diamond graph + tail)", () => {
  // "D" will be likely updated twice if our mark+sweep logic is buggy.
  //     X
  //   /   \
  //  A     B
  //   \   /
  //     C
  //     |
  //     D

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());
  const $c = createMemo(() => $a() + " " + $b());

  const spy = vi.fn(() => $c());
  const $d = createMemo(spy);

  expect($d()).toBe("a a");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($d()).toBe("aa aa");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should bail out if result is the same", () => {
  // Bail out if value of "A" never changes
  // X->A->B

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => {
    $x();
    return "foo";
  });

  const spy = vi.fn(() => $a());
  const $b = createMemo(spy);

  expect($b()).toBe("foo");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($b()).toBe("foo");
  expect(spy).toHaveBeenCalledTimes(1);
});

it("should only update every signal once (jagged diamond graph + tails)", () => {
  // "E" and "F" will be likely updated >3 if our mark+sweep logic is buggy.
  //     X
  //   /   \
  //  A     B
  //  |     |
  //  |     C
  //   \   /
  //     D
  //   /   \
  //  E     F

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());
  const $c = createMemo(() => $b());

  const dSpy = vi.fn(() => $a() + " " + $c());
  const $d = createMemo(dSpy);

  const eSpy = vi.fn(() => $d());
  const $e = createMemo(eSpy);
  const fSpy = vi.fn(() => $d());
  const $f = createMemo(fSpy);

  expect($e()).toBe("a a");
  expect(eSpy).toHaveBeenCalledTimes(1);

  expect($f()).toBe("a a");
  expect(fSpy).toHaveBeenCalledTimes(1);

  setX("b");

  expect($d()).toBe("b b");
  expect(dSpy).toHaveBeenCalledTimes(2);

  expect($e()).toBe("b b");
  expect(eSpy).toHaveBeenCalledTimes(2);

  expect($f()).toBe("b b");
  expect(fSpy).toHaveBeenCalledTimes(2);

  setX("c");

  expect($d()).toBe("c c");
  expect(dSpy).toHaveBeenCalledTimes(3);

  expect($e()).toBe("c c");
  expect(eSpy).toHaveBeenCalledTimes(3);

  expect($f()).toBe("c c");
  expect(fSpy).toHaveBeenCalledTimes(3);
});

it("should ensure subs update even if one dep is static", () => {
  //     X
  //   /   \
  //  A     *B <- returns same value every time
  //   \   /
  //     C

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => {
    $x();
    return "c";
  });

  const spy = vi.fn(() => $a() + " " + $b());
  const $c = createMemo(spy);

  expect($c()).toBe("a c");

  setX("aa");

  expect($c()).toBe("aa c");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should ensure subs update even if two deps mark it clean", () => {
  // In this scenario both "B" and "C" always return the same value. But "D" must still update
  // because "X" marked it. If "D" isn't updated, then we have a bug.
  //     X
  //   / | \
  //  A *B *C
  //   \ | /
  //     D

  const [$x, setX] = createSignal("a");

  const $b = createMemo(() => $x());
  const $c = createMemo(() => {
    $x();
    return "c";
  });
  const $d = createMemo(() => {
    $x();
    return "d";
  });

  const spy = vi.fn(() => $b() + " " + $c() + " " + $d());
  const $e = createMemo(spy);

  expect($e()).toBe("a c d");

  setX("aa");

  expect($e()).toBe("aa c d");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("propagates in topological order", () => {
  //
  //     c1
  //    /  \
  //   /    \
  //  b1     b2
  //   \    /
  //    \  /
  //     a1
  //
  var seq = "",
    [a1, setA1] = createSignal(false),
    b1 = createMemo(
      () => {
        a1();
        seq += "b1";
      },
      undefined,
      { equals: false }
    ),
    b2 = createMemo(
      () => {
        a1();
        seq += "b2";
      },
      undefined,
      { equals: false }
    ),
    c1 = createMemo(
      () => {
        b1(), b2();
        seq += "c1";
      },
      undefined,
      { equals: false }
    );

  c1();
  seq = "";
  setA1(true);
  c1();
  expect(seq).toBe("b1b2c1");
});

it("only propagates once with linear convergences", () => {
  //         d
  //         |
  // +---+---+---+---+
  // v   v   v   v   v
  // f1  f2  f3  f4  f5
  // |   |   |   |   |
  // +---+---+---+---+
  //         v
  //         g
  var [d, setD] = createSignal(0),
    f1 = createMemo(() => d()),
    f2 = createMemo(() => d()),
    f3 = createMemo(() => d()),
    f4 = createMemo(() => d()),
    f5 = createMemo(() => d()),
    gcount = 0,
    g = createMemo(() => {
      gcount++;
      return f1() + f2() + f3() + f4() + f5();
    });

  g();
  gcount = 0;
  setD(1);
  g();
  expect(gcount).toBe(1);
});

it("only propagates once with exponential convergence", () => {
  //     d
  //     |
  // +---+---+
  // v   v   v
  // f1  f2 f3
  //   \ | /
  //     O
  //   / | \
  // v   v   v
  // g1  g2  g3
  // +---+---+
  //     v
  //     h
  var [d, setD] = createSignal(0),
    f1 = createMemo(() => {
      return d();
    }),
    f2 = createMemo(() => {
      return d();
    }),
    f3 = createMemo(() => {
      return d();
    }),
    g1 = createMemo(() => {
      return f1() + f2() + f3();
    }),
    g2 = createMemo(() => {
      return f1() + f2() + f3();
    }),
    g3 = createMemo(() => {
      return f1() + f2() + f3();
    }),
    hcount = 0,
    h = createMemo(() => {
      hcount++;
      return g1() + g2() + g3();
    });
  h();
  hcount = 0;
  setD(1);
  h();
  expect(hcount).toBe(1);
});

it("does not trigger downstream computations unless changed", () => {
  const [s1, set] = createSignal(1, { equals: false });
  let order = "";
  const t1 = createMemo(() => {
    order += "t1";
    return s1();
  });
  const t2 = createMemo(() => {
    order += "c1";
    t1();
  });
  t2();
  expect(order).toBe("c1t1");
  order = "";
  set(1);
  t2();
  expect(order).toBe("t1");
  order = "";
  set(2);
  t2();
  expect(order).toBe("t1c1");
});

it("applies updates to changed dependees in same order as createMemo", () => {
  const [s1, set] = createSignal(0);
  let order = "";
  const t1 = createMemo(() => {
    order += "t1";
    return s1() === 0;
  });
  const t2 = createMemo(() => {
    order += "c1";
    return s1();
  });
  const t3 = createMemo(() => {
    order += "c2";
    return t1();
  });
  t2();
  t3();
  expect(order).toBe("c1c2t1");
  order = "";
  set(1);
  t2();
  t3();
  expect(order).toBe("c1t1c2");
});

it("updates downstream pending computations", () => {
  const [s1, set] = createSignal(0);
  const [s2] = createSignal(0);
  let order = "";
  const t1 = createMemo(() => {
    order += "t1";
    return s1() === 0;
  });
  const t2 = createMemo(() => {
    order += "c1";
    return s1();
  });
  const t3 = createMemo(() => {
    order += "c2";
    t1();
    return createMemo(() => {
      order += "c2_1";
      return s2();
    });
  });
  order = "";
  set(1);
  t2();
  t3()();
  expect(order).toBe("c1c2t1c2_1");
});

describe("with changing dependencies", () => {
  let i: () => boolean, setI: (v: boolean) => void;
  let t: () => number, setT: (v: number) => void;
  let e: () => number, setE: (v: number) => void;
  let fevals: number;
  let f: () => number;

  function init() {
    [i, setI] = createSignal<boolean>(true);
    [t, setT] = createSignal(1);
    [e, setE] = createSignal(2);
    fevals = 0;
    f = createMemo(() => {
      fevals++;
      return i() ? t() : e();
    });
    f();
    fevals = 0;
  }

  it("updates on active dependencies", () => {
    init();
    setT(5);
    expect(f()).toBe(5);
    expect(fevals).toBe(1);
  });

  it("does not update on inactive dependencies", () => {
    init();
    setE(5);
    expect(f()).toBe(1);
    expect(fevals).toBe(0);
  });

  it("deactivates obsolete dependencies", () => {
    init();
    setI(false);
    f();
    fevals = 0;
    setT(5);
    f();
    expect(fevals).toBe(0);
  });

  it("activates new dependencies", () => {
    init();
    setI(false);
    fevals = 0;
    setE(5);
    f();
    expect(fevals).toBe(1);
  });

  it("ensures that new dependencies are updated before dependee", () => {
    var order = "",
      [a, setA] = createSignal(0),
      b = createMemo(() => {
        order += "b";
        return a() + 1;
      }),
      c = createMemo(() => {
        order += "c";
        const check = b();
        if (check) {
          return check;
        }
        return e();
      }),
      d = createMemo(() => {
        return a();
      }),
      e = createMemo(() => {
        order += "d";
        return d() + 10;
      });

    c();
    e();
    expect(order).toBe("cbd");

    order = "";
    setA(-1);
    c();
    e();

    expect(order).toBe("bcd");
    expect(c()).toBe(9);

    order = "";
    setA(0);
    c();
    e();
    expect(order).toBe("bcd");
    expect(c()).toBe(1);
  });
});

it("does not update subsequent pending computations after stale invocations", () => {
  const [s1, set1] = createSignal(1);
  const [s2, set2] = createSignal(false);
  let count = 0;
  /*
                  s1
                  |
              +---+---+
             t1 t2 c1 t3
              \       /
                 c3
           [PN,PN,STL,void]
      */
  const t1 = createMemo(() => s1() > 0);
  const t2 = createMemo(() => s1() > 0);
  const c1 = createMemo(() => s1());
  const t3 = createMemo(() => {
    const a = s1();
    const b = s2();
    return a && b;
  });
  const c3 = createMemo(() => {
    t1();
    t2();
    c1();
    t3();
    count++;
  });
  c3();
  set2(true);
  c3();
  expect(count).toBe(2);
  set1(2);
  c3();
  expect(count).toBe(3);
});

it("evaluates stale computations before dependees when trackers stay unchanged", () => {
  let [s1, set] = createSignal(1, { equals: false });
  let order = "";
  let t1 = createMemo(() => {
    order += "t1";
    return s1() > 2;
  });
  let t2 = createMemo(() => {
    order += "t2";
    return s1() > 2;
  });
  let c1 = createMemo(
    () => {
      order += "c1";
      s1();
    },
    undefined,
    { equals: false }
  );
  const c2 = createMemo(() => {
    order += "c2";
    t1();
    t2();
    c1();
  });
  c2();
  order = "";
  set(1);
  c2();
  expect(order).toBe("t1t2c1c2");
  order = "";
  set(3);
  c2();
  expect(order).toBe("t1c2t2c1");
});

it("correctly marks downstream computations as stale on change", () => {
  const [s1, set] = createSignal(1);
  let order = "";
  const t1 = createMemo(() => {
    order += "t1";
    return s1();
  });
  const c1 = createMemo(() => {
    order += "c1";
    return t1();
  });
  const c2 = createMemo(() => {
    order += "c2";
    return c1();
  });
  const c3 = createMemo(() => {
    order += "c3";
    return c2();
  });
  c3();
  order = "";
  set(2);
  c3();
  expect(order).toBe("t1c1c2c3");
});
