import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const delay = <T = void>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

// #3459: `Loading on={a()}` over `fast = createMemo(async () => a())` and
// `slow = createMemo(() => delay(200, b()))`. `setB(1); await 50; setA(1)`.
// The `on` reset takes the hold off the lane (#3375: fallback-caught async
// holds nothing), so B: 1 commits — and the boundary must carry the hold
// instead, staying on its fallback until slow's b=1 flight lands. Readers
// already pending never re-notify, so the reset has to collect them itself.
async function scenario(shape: "two-effects" | "one-effect") {
  const log: string[] = [];
  const out = { b: 0 as any, fast: "?" as any, slow: "?" as any, boundary: "?" as any };
  let click!: () => Promise<void>;
  const snap = () =>
    `B: ${out.b} | ${out.boundary === "loading" ? "Loading" : `Fast: ${out.fast} | Slow: ${out.slow}`}`;
  createRoot(() => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const fast = createMemo(async () => a());
    const slow = createMemo(() => delay(200, b()));
    createRenderEffect(
      () => b(),
      v => {
        out.b = v;
      }
    );
    const boundary = createLoadingBoundary(
      () => {
        if (shape === "two-effects") {
          createRenderEffect(
            () => fast(),
            v => {
              out.fast = v;
            }
          );
          createRenderEffect(
            () => slow(),
            v => {
              out.slow = v;
            }
          );
        } else {
          createRenderEffect(
            () => [fast(), slow()],
            ([f, s]) => {
              out.fast = f;
              out.slow = s;
            }
          );
        }
        return "content";
      },
      () => "loading",
      { on: a }
    );
    createRenderEffect(boundary, v => {
      out.boundary = v;
    });
    click = async () => {
      setB(1);
      await delay(50);
      setA(1);
    };
  });
  await delay(250);
  flush();
  log.push(`initial: ${snap()}`);
  void click();
  for (let t = 0; t <= 300; t += 25) {
    flush();
    log.push(`t=${t}: ${snap()}`);
    await delay(25);
  }
  return log;
}

describe("A15 / #3459 a Loading `on` reset keeps the fallback until every reader under it settles", () => {
  it("A15 / #3459 fast and slow read from sibling effects (the JSX shape): fallback until slow lands", async () => {
    const log = await scenario("two-effects");
    expect(log[0]).toBe("initial: B: 0 | Fast: 0 | Slow: 0");
    // Before the reset the lane holds B with slow's flight.
    expect(log[1]).toBe("t=0: B: 0 | Fast: 0 | Slow: 0");
    // The reset commits B and moves the hold onto the boundary (INV-3 reporters).
    for (const line of log) expect(line, line).not.toMatch(/Fast: 1 \| Slow: 0/);
    expect(log.find(l => l.startsWith("t=50:"))).toBe("t=50: B: 1 | Loading");
    expect(log.at(-1)).toBe("t=300: B: 1 | Fast: 1 | Slow: 1");
  });
  it("A15 / #3459 control: one effect reading both — the notifying reader carries slow in its pending sources", async () => {
    const log = await scenario("one-effect");
    for (const line of log) expect(line, line).not.toMatch(/Fast: 1 \| Slow: 0/);
    expect(log.find(l => l.startsWith("t=50:"))).toBe("t=50: B: 1 | Loading");
    expect(log.at(-1)).toBe("t=300: B: 1 | Fast: 1 | Slow: 1");
  });
});
