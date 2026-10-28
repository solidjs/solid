// #4365 (F-1, F-6, D-41): a pass reads `latest(a)` beside `b()` in a
// flush that carries both writes, with nothing held. The `latest()` read of
// a's staging opened the flush's transaction for its verdict (verdict.ts
// `provisionalVerdict`, `joinFuture(null)`). The plain read after it then
// took that transaction for a hold: it served b's committed value
// (`stagedScreen`) and left the reader to re-derive at the landing. Nothing
// held the flush, so the torn pass was one of its frames: its runs reached
// render effects through a memo (`[2,1]` before `[2,2]`), and a throw from
// it stuck. `latest()` now opens no transaction: its reader watches the
// seam, its pass is the frame's (one pass on the frame's world), and it
// re-derives in the verdict lane if the flush parks (display-ahead).
import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

describe("#4365: latest(a) beside b() on a batched write", () => {
  it.each(["memo", "effect"])("a throw from the pass does not stick (%s)", reader => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(0);
    const passes: string[] = [];
    let out = "";
    const dispose = createRoot(dispose => {
      const f = () => {
        const v = latest(a) + b() + 1;
        passes.push(`${latest(a)}+${b()}`);
        if (v % 4 === 3) throw new Error("m:" + v);
        return v;
      };
      // `<Errored><span title={String(m())} /></Errored>`
      const view = createErrorBoundary(
        () =>
          untrack(() => {
            if (reader === "effect") createRenderEffect(f, v => void (out = `title=${v}`));
            else {
              const m = createMemo(f);
              createRenderEffect(
                () => m(),
                v => void (out = `title=${v}`)
              );
            }
            return "content";
          }),
        (e: () => any) => `[E ${e()?.message}]`
      );
      createRenderEffect(
        () => view(),
        v => void (v !== "content" && (out = String(v)))
      );
      return dispose;
    });
    flush();
    expect(out).toBe("title=2");
    passes.length = 0;
    setB(3);
    setA(2);
    flush();
    expect(passes).toEqual(["2+3"]);
    expect(out).toBe("title=6");
    dispose();
  });

  it.each(["[latest(s), s()]", "[s(), latest(s)]"])(
    "a memo of %s commits one whole frame on a plain write",
    order => {
      const [s, set] = createSignal(1);
      const seen: string[] = [];
      const dispose = createRoot(dispose => {
        const m = createMemo(() =>
          order === "[latest(s), s()]" ? [latest(s), s()] : [s(), latest(s)]
        );
        createRenderEffect(m, v => void seen.push(String(v)));
        return dispose;
      });
      flush();
      set(2);
      flush();
      expect(seen).toEqual(["1,1", "2,2"]);
      dispose();
    }
  );

  // The flush parks on an async of b: the pass is held with the frame (or,
  // re-derived at the seam, a display-ahead pass over the screen) — never
  // b's staging beside the async still answering for its old value.
  it.each(
    ["memo", "effect"].flatMap(reader => [
      `${reader} [latest(a), b()]`,
      `${reader} [b(), latest(a)]`
    ])
  )("a pass in a flush that parks never shows b's staging beside its async (%s)", async shape => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(1);
    let resolve!: () => void;
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const slow = createMemo(() => {
        const v = b();
        return v > 1 ? new Promise<number>(r => (resolve = () => r(v))) : v;
      });
      const f = () => (shape.endsWith("[latest(a), b()]") ? [latest(a), b()] : [b(), latest(a)]);
      const m = shape.startsWith("memo") ? createMemo(f) : f;
      createRenderEffect(
        () => [...m(), slow()],
        v => void seen.push(String(v))
      );
      return dispose;
    });
    flush();
    setA(2);
    setB(2);
    flush();
    resolve();
    await tick();
    for (const frame of seen) {
      const [x, y, z] = frame.split(",").map(Number);
      expect(shape.endsWith("[latest(a), b()]") ? y : x).toBe(z);
    }
    expect(seen[seen.length - 1]).toBe("2,2,2");
    dispose();
  });

  // The flush parks on an async another render effect reads: the pass
  // re-derives at the seam as the verdict lane's, `latest(a)` shown ahead
  // beside b's screen value, and again at the landing.
  it.each(["memo", "effect"])(
    "the pass re-derives ahead of a flush that parks, and at its landing (%s)",
    async reader => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(1);
      const [c, setC] = createSignal(1);
      let resolve!: () => void;
      const seen: string[] = [];
      const dispose = createRoot(dispose => {
        const slow = createMemo(() => {
          const v = c();
          return v > 1 ? new Promise<number>(r => (resolve = () => r(v))) : v;
        });
        createRenderEffect(slow, () => {});
        const f = () => [latest(a), b()];
        const m = reader === "memo" ? createMemo(f) : f;
        createRenderEffect(
          () => m(),
          v => void seen.push(String(v))
        );
        return dispose;
      });
      flush();
      setA(2);
      setB(2);
      setC(2);
      flush();
      expect(seen).toEqual(["1,1", "2,1"]);
      resolve();
      await tick();
      expect(seen).toEqual(["1,1", "2,1", "2,2"]);
      dispose();
    }
  );

  // Held: the display-ahead pass `[latest(a), b()]` throws over b's screen
  // value; the landing re-derives it on the landed world (the landing skipped
  // an errored reader, and the error stuck).
  it.each(["memo", "effect"])(
    "a pass that threw ahead of a hold re-derives at its landing (%s)",
    async reader => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(0);
      const [c, setC] = createSignal(1);
      let resolve!: () => void;
      let out = "";
      const dispose = createRoot(dispose => {
        const slow = createMemo(() => {
          const v = c();
          return v > 1 ? new Promise<number>(r => (resolve = () => r(v))) : v;
        });
        createRenderEffect(slow, () => {});
        const f = () => {
          const v = latest(a) + b() + 1;
          if (v % 4 === 3) throw new Error("m:" + v);
          return v;
        };
        const view = createErrorBoundary(
          () =>
            untrack(() => {
              if (reader === "effect") createRenderEffect(f, v => void (out = `title=${v}`));
              else {
                const m = createMemo(f);
                createRenderEffect(
                  () => m(),
                  v => void (out = `title=${v}`)
                );
              }
              return "content";
            }),
          (e: () => any) => `[E ${e()?.message}]`
        );
        createRenderEffect(
          () => view(),
          v => void (v !== "content" && (out = String(v)))
        );
        return dispose;
      });
      flush();
      expect(out).toBe("title=2");
      setA(2);
      setB(3);
      setC(2);
      flush();
      resolve();
      await tick();
      expect(out).toBe("title=6");
      dispose();
    }
  );
});
