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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("without initialValue but setting a value in the setup", async () => {
   let out: () => undefined | number;

    createRoot(() => {
      out = from({
        subscribe: (set) => {
          let counter = 0;
          const interval = setInterval(() => {
            set(counter++);
          }, 100);
          return () => { 
            clearInterval(interval) 
          };
        },
      });
    });

    expect(out!()).toBe(undefined);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(1);
  });

  test("without initialValue but setting a value in the setup", async () => {
    let out: () => undefined | number;

    createRoot(() => {
      out = from({
        subscribe: (set) => {
          let counter = 0;
          set(0);
          const interval = setInterval(() => {
            set(++counter);
          }, 100);
          return () => { 
            clearInterval(interval) 
          };
        },
      });
    });

    expect(out!()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(2);
  });

  test("with initialValue", async () => {
    let out: () => number; // froms with initalValue can be strongly typed

    createRoot(() => {
      let counter = 0;
      out = from({
        subscribe: (set) => {
          const interval = setInterval(() => {
            set(++counter);
          }, 100);
          return () => { 
            clearInterval(interval) 
          };
        },
        initialValue: counter,
      });
    });

    expect(out!()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(out!()).toBe(2);
  });

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
