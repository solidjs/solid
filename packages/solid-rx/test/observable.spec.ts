import { createSignal, createRoot } from "solid-js";
import { observable } from "../src";

describe("Observable operator", () => {
  test("to observable", async () => {
    let out: string;
    let set: (string) => void;
    createRoot(() => {
      const [s, _set] = createSignal("Hi"),
        obsv$ = observable<string>(s);

      set = _set;
      obsv$.subscribe({ next: v => (out = v) });
    });
    expect(out).toBe("Hi");
    set("John");
    expect(out).toBe("John");
  });
});
