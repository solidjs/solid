// #4283 (S-5 rows 1′–3′, D-4, D-3): two mounts made in separate flushes,
// each reading a value held by its own hold, settle independently — with or
// without a boundary around them. The boundary's tree and output are
// structure, not a user derivation of both mounts: they read the screen like
// the render effect that would flatten the same children without one.
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it.each(["error", "loading", "none"])(
  "two mounts made in separate flushes keep independent holds (boundary: %s)",
  async boundary => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const [showA, setShowA] = createSignal(false);
    const [showB, setShowB] = createSignal(false);
    const res = new Map<string, (v: string) => void>();
    const fetchKey = (k: string) => new Promise<string>(r => res.set(k, r));
    const screen: Record<string, string> = {};
    createRoot(() => {
      const slowA = createMemo(() => fetchKey("A:" + a()));
      const slowB = createMemo(() => fetchKey("B:" + b()));
      // `<p>{slowA()}/{slowB()}</p>` and two `<Show>`s, each mounting
      // `<p>{createMemo(() => x())()}</p>`.
      const branches = () => {
        createRenderEffect(
          () => `${slowA()}/${slowB()}`,
          v => void (screen.p = v)
        );
        const show = (when: () => boolean, key: string, x: () => number) =>
          createMemo(() => {
            if (!when()) return null;
            const m = createMemo(() => x());
            createRenderEffect(
              () => `${key} ${m()}`,
              v => void (screen[key] = v)
            );
            return key;
          });
        return [show(showA, "pA", a), show(showB, "pB", b)];
      };
      if (boundary === "none") for (const m of untrack(branches)) createRenderEffect(m, () => {});
      else
        createRenderEffect(
          (boundary === "error" ? createErrorBoundary : createLoadingBoundary)(
            () => untrack(branches),
            () => "fallback"
          ),
          v => void (screen.out = String(v))
        );
    });
    const out = (v: string) => (boundary === "none" ? {} : { out: v });
    flush();
    res.get("A:0")!("x");
    res.get("B:0")!("y");
    await tick();
    setA(1);
    flush();
    await tick();
    setB(1);
    flush();
    await tick();
    // Two mounts, two flushes: each joins only the hold its own flush read.
    setShowA(true);
    flush();
    await tick();
    setShowB(true);
    flush();
    await tick();
    expect(screen).toEqual({ p: "x/y", ...out(",") });

    res.get("A:1")!("x1");
    await tick();
    expect(screen).toEqual({ p: "x1/y", pA: "pA 1", ...out("pA,") });

    res.get("B:1")!("y1");
    await tick();
    expect(screen).toEqual({ p: "x1/y1", pA: "pA 1", pB: "pB 1", ...out("pA,pB") });
  }
);
