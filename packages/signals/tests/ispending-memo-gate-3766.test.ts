import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const delay = <T>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("#3766 memo over isPending read beside a second async memo", () => {
  for (const variant of ["memo-first", "gate-first", "inline"] as const) {
    it(`initial mount: ${variant}`, async () => {
      const seen: string[] = [];
      createRoot(() => {
        const source = createMemo(() => delay(10, 10));
        const gate = createMemo(() => delay(100, 20));
        const pending = createMemo(() => isPending(source));
        createRenderEffect(
          () =>
            variant === "memo-first"
              ? `${pending()} | ${gate()}`
              : variant === "gate-first"
                ? `${gate()} | ${pending()}`
                : `${isPending(source)} | ${gate()}`,
          v => {
            seen.push(v);
          }
        );
      });
      flush();
      await wait(100);
      flush();
      expect(seen).toEqual([variant === "gate-first" ? "100 | false" : "false | 100"]);
    });
  }

  it("initial mount: a second reader still waiting holds the first", async () => {
    const seen: string[] = [];
    createRoot(() => {
      const source = createMemo(() => delay(10, 10));
      const gate = createMemo(() => delay(100, 20));
      const late = createMemo(() => delay(200, 40));
      const pending = createMemo(() => isPending(source));
      createRenderEffect(
        () => `a ${pending()} | ${gate()}`,
        v => {
          seen.push(v);
        }
      );
      createRenderEffect(
        () => `b ${pending()} | ${late()}`,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    await wait(100);
    flush();
    expect(seen).toEqual(["a false | 100", "b false | 200"]);
  });

  it("initial mount: a plain write while the reader waits on gate", async () => {
    const seen: string[] = [];
    let setLabel!: (v: string) => void;
    createRoot(() => {
      const [label, set] = createSignal("a");
      setLabel = set;
      const source = createMemo(() => delay(10, 10));
      const gate = createMemo(() => delay(100, 60));
      const pending = createMemo(() => isPending(source));
      createRenderEffect(
        () => `${label()} ${pending()} | ${gate()}`,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    await wait(30);
    setLabel("b");
    flush();
    expect(seen).toEqual([]);
    await wait(100);
    flush();
    expect(seen).toEqual(["b false | 100"]);
  });

  it("update: two readers of gate agree", async () => {
    let a = "";
    let b = "";
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, set] = createSignal(1);
      setCount = set;
      const source = createMemo(() => delay(count(), 10));
      const gate = createMemo(() => delay(count() * 100, 20));
      const pending = createMemo(() => isPending(source));
      const slow = createMemo(() => {
        const value = pending();
        return delay(value, value ? 30 : 300);
      });
      createRenderEffect(
        () => `${pending()} | ${gate()}`,
        v => {
          a = v;
        }
      );
      createRenderEffect(
        () => `${slow()} | ${gate()}`,
        v => {
          b = v;
        }
      );
    });
    flush();
    await wait(400);
    flush();
    expect([a, b]).toEqual(["false | 100", "false | 100"]);
    setCount(2);
    flush();
    for (let i = 0; i < 50; i++) {
      await wait(10);
      expect(a.split(" | ")[1]).toBe(b.split(" | ")[1]);
    }
    expect([a, b]).toEqual(["false | 200", "false | 200"]);
  });
});
