import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  NotReadyError
} from "../src/index.js";

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// #4244: an error that answered a memo's first read cleared its
// uninitialized status, so a re-ask made it "pending with a value" and
// verdict reads (`isPending` passes, `latest`) returned its `undefined`
// `_value` instead of throwing NotReady.
function setup(first: "reject" | "value") {
  const [n, setN] = createSignal(0);
  const seen: unknown[] = [];
  const latestSeen: unknown[] = [];
  const shape = (f: () => unknown) => {
    try {
      return f();
    } catch (e) {
      return e instanceof NotReadyError ? "NotReady" : `error:${(e as Error).message}`;
    }
  };
  createRoot(() => {
    const m = createMemo(() => {
      const i = n();
      if (i === 0)
        return first === "reject" ? Promise.reject(new Error("boom")) : Promise.resolve("first");
      if (i === 1 && first === "value") return Promise.reject(new Error("boom"));
      return new Promise<string>(r => setTimeout(() => r("ok"), 20));
    });
    createRenderEffect(
      () => shape(() => [isPending(() => m()), m()]),
      v => {
        seen.push(v);
      }
    );
    createRenderEffect(
      () => shape(() => latest(() => m())),
      v => {
        latestSeen.push(v);
      }
    );
  });
  return { setN, seen, latestSeen };
}

describe("#4244 a memo whose first read rejected, re-asked", () => {
  it("throws NotReady in an isPending pass and from latest() until a value lands", async () => {
    const t = setup("reject");
    flush();
    await tick();
    flush();
    expect(t.seen.at(-1)).toMatch(/^error:/);
    t.setN(1);
    flush();
    await tick();
    flush();
    expect(t.seen.at(-1)).toBe("NotReady");
    expect(t.latestSeen.at(-1)).toBe("NotReady");
    await tick(40);
    flush();
    expect(t.seen.at(-1)).toEqual([false, "ok"]);
    expect(t.latestSeen.at(-1)).toBe("ok");
    expect(t.seen.flat()).not.toContain(undefined);
  });

  it("an error boundary keeps showing the first-read error while it is re-asked", async () => {
    const [n, setN] = createSignal(0);
    const log: unknown[] = [];
    createRoot(() => {
      const m = createMemo(() =>
        n() === 0
          ? Promise.reject(new Error("boom"))
          : new Promise<string>(r => setTimeout(() => r("ok"), 20))
      );
      const view = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => `value:${m()}`,
            () => "loading"
          ),
        (e: () => unknown) => `caught:${(e() as Error)?.message}`
      );
      createRenderEffect(
        () => {
          const v = view();
          return typeof v === "function" ? (v as () => unknown)() : v;
        },
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await tick();
    flush();
    setN(1);
    flush();
    await tick();
    flush();
    expect(log).toEqual(["loading", "caught:boom"]);
    await tick(40);
    flush();
    expect(log).toEqual(["loading", "caught:boom", "value:ok"]);
  });

  it("control: a memo that had a value before its error is not uninitialized when re-asked", async () => {
    const t = setup("value");
    flush();
    await tick();
    flush();
    expect(t.latestSeen.at(-1)).toBe("first");
    t.setN(1);
    flush();
    await tick();
    flush();
    expect(t.seen.at(-1)).toMatch(/^error:/);
    t.setN(2);
    flush();
    await tick();
    flush();
    expect(t.seen.at(-1)).not.toBe("NotReady");
    expect(t.latestSeen.at(-1)).not.toBe("NotReady");
    await tick(40);
    flush();
    expect(t.latestSeen.at(-1)).toBe("ok");
  });
});
