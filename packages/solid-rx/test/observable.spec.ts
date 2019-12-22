import { createSignal } from "solid-js";
import { observable } from "../src";

describe("Observable operator", () => {
  test("to observable", async () => {
    let out: string;
    const [s, set] = createSignal("Hi"),
      obsv$ = observable(s);

    obsv$.subscribe({ next: v => out = v });
    expect(out).toBe("Hi");
    set("John");
    expect(out).toBe("John");
  });
});
