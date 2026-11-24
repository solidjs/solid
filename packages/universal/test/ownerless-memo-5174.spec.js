import * as r from "./custom.js";
import { action, createRoot, createSignal, flush, refresh } from "solid-js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(res => setTimeout(res, 0));
    flush();
  }
};

describe("universal memo with no owner (#5174)", () => {
  it("a handler read of a compiled condition sees the loaded value while its source re-asks", async () => {
    const asks = [];
    const parent = document.createElement("div");
    let ans, reask;
    const dispose = createRoot(d => {
      [ans] = createSignal(async () => await new Promise(res => asks.push(res)), {
        loadingValue: null
      });
      r.insert(parent, () => (ans() == null ? "loading" : ans().length));
      reask = action(function* () {
        refresh(ans);
      });
      return d;
    });
    const read = () => {
      try {
        return r.memo(() => ans() == null)() ? -1 : ans().length;
      } catch (e) {
        return e.constructor.name;
      }
    };
    await tick();
    asks.shift()([1, 2]);
    await tick();
    expect(read()).toBe(2);
    reask();
    await tick();
    expect(read()).toBe(2);
    asks.shift()([1, 2, 3]);
    await tick();
    expect(read()).toBe(3);
    expect(parent.innerHTML).toBe("3");
    dispose();
  });

  it("a conditional inserted with no owner follows its condition and rebuilds its branch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [n, setN] = createSignal(1);
    const parent = document.createElement("div");
    let made = 0;
    r.insert(
      parent,
      (() => {
        const c = r.memo(() => n() > 0);
        return () => (c() ? (made++, "big") : "small");
      })()
    );
    flush();
    setN(2);
    flush();
    expect(parent.innerHTML).toBe("big");
    expect(made).toBe(2);
    setN(0);
    flush();
    expect(parent.innerHTML).toBe("small");
    warn.mockRestore();
  });
});
