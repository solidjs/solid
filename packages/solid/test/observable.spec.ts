import { createRoot, createSignal, from, observable } from "../src";

describe("Observable operator", () => {
  test("to observable", () => {
    let out: string;
    let set: (v: string) => void;
    createRoot(() => {
      const [s, _set] = createSignal("Hi"),
        obsv$ = observable(s);

      set = _set;
      obsv$.subscribe({ next: v => (out = v) });
    });
    expect(out!).toBe("Hi");
    set!("John");
    expect(out!).toBe("John");
  });

  test("preserve the observer's next binding", () => {
    const observer = {
      next: vi.fn().mockReturnThis()
    };

    createRoot(() => {
      const [s] = createSignal("Hi"),
        obsv$ = observable(s);

      obsv$.subscribe(observer);
    });
    expect(observer.next).toHaveReturnedWith(observer);
  });

  test("observable throws TypeError on non-object", () => {
    const [s, _set] = createSignal("Hi");
    const o = observable(s);
    expect(() => o.subscribe(null as any)).toThrow(TypeError);
  });

  test("observable unsubscribe", () => {
    const [s, set] = createSignal("Hi");
    const o = observable(s);
    let out: string;
    let subscription: any;
    createRoot(() => {
      subscription = o.subscribe({
        next(v) {
          out = v;
        }
      });
    });
    set("John");
    expect(out!).toBe("John");
    subscription.unsubscribe();
    set("Benjamin");
    expect(out!).toBe("John");
  });
});

describe("from transform", () => {
  test("from subscribable", async () => {
    let out: () => string | undefined;
    let set: (v: string) => void;
    createRoot(() => {
      const [s, _set] = createSignal("Hi"),
        obsv$ = observable(s);

      set = _set;
      out = from(obsv$);
    });
    expect(out!()).toBe("Hi");
    set!("John");
    expect(out!()).toBe("John");
  });

  test("from producer", async () => {
    let out: () => string | undefined;
    let set: (v: string) => void;
    createRoot(() => {
      const [s, _set] = createSignal("Hi"),
        obsv$ = observable(s);

      set = _set;
      out = from(set => {
        const sub = obsv$.subscribe(set);
        return () => sub.unsubscribe();
      });
    });
    expect(out!()).toBe("Hi");
    set!("John");
    expect(out!()).toBe("John");
  });
});
