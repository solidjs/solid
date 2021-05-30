import { createSignal, createRoot, observable } from "../src";

describe("Observable operator", () => {
  test("to observable", async () => {
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
});
