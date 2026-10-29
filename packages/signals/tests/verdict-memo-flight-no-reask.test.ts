// A memo that reads a verdict memo is a verdict reader (F-6, #4050) without
// opening a window of its own. When that verdict memo goes pending, what the
// memo read ahead is in flight: it is pending through the flight like any
// derivation (F-9) and the hold's work until it lands (D-25, #3884), so an
// async one asks its next question once, at the landing. Before: `m1` over
// `m0 = ask(1 + latest(s) + s())` was re-derived when `m0` re-asked, served
// `m0`'s committed value (A10) — the one it had already derived `m1:5` from —
// and asked `m1:5` again; that flight held the verdict lane, `m0`'s landing
// re-ran it as lane work onto the same committed value (a third `m1:5`), and
// only the landing's re-derive asked `m1:6`.
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(15);
    flush();
  }
}

const expected = {
  // The verdict lane answers m0's display-ahead intermediate (`latest(s)` = 2
  // beside the screen's `s()` = 1) and m1 over it while `h` holds the write
  // (F-6: async derived from a display-ahead read is the lane's), then the
  // landing asks each memo once.
  "latest held": ["m0:4", "m1:5", "m0:5", "m1:6"],
  "latest unheld": ["m0:4", "m0:5", "m1:6"],
  "plain held": ["m0:5", "m1:6"],
  "plain unheld": ["m0:5", "m1:6"]
};

for (const useLatest of [true, false])
  for (const heldWrite of [true, false]) {
    const name = `${useLatest ? "latest" : "plain"} ${heldWrite ? "held" : "unheld"}`;
    it(`${name}: an async memo over a verdict memo asks each question once`, async () => {
      const [s, setS] = createSignal(1);
      const asks: string[] = [];
      const ask = (name: string, v: number) => {
        asks.push(`${name}:${v}`);
        return sleep(10).then(() => {
          if (v === 3) throw new Error(`${name}:${v}`);
          return v;
        });
      };
      const out: string[] = [];
      createRoot(() => {
        const m0 = createMemo(() => ask("m0", 1 + (useLatest ? latest(s) : s()) + s()));
        const m1 = createMemo(() => ask("m1", 1 + m0()));
        // Holds the write's frame for 80ms (the boundary's content reads it).
        const h = createMemo(() => (s() === 1 ? 1 : sleep(80).then(() => 1)));
        createErrorBoundary(
          () =>
            createLoadingBoundary(
              () => {
                createRenderEffect(
                  () => (heldWrite ? h() : 0, String(isPending(m1))),
                  v => void out.push(v)
                );
                return null;
              },
              () => "L"
            ),
          () => "E"
        );
      });
      flush();
      await settle();
      expect(asks).toEqual(["m0:3"]);
      setS(2);
      await settle();
      await settle();
      const after = asks.slice(1);
      expect(after).toEqual(expected[name as keyof typeof expected]);
      const m1Asks = after.filter(a => a.startsWith("m1"));
      expect(new Set(m1Asks).size).toBe(m1Asks.length);
      expect(out[out.length - 1]).toBe("false");
    });
  }

// Settled memos, no boundary hold: the verdict lane shows `m0:4`/`m1:5`, the
// write's landing re-asks `m0`, and `m1` waits on it — pending throughout,
// its next question asked once.
for (const reader of ["m1()", "[isPending(m1), m1()]"] as const)
  it(`${reader}: a memo over a re-asking verdict memo waits on it, pending`, async () => {
    const [s, setS] = createSignal(1);
    const asks: string[] = [];
    const ask = (name: string, v: number) => {
      asks.push(`${name}:${v}`);
      return sleep(10).then(() => v);
    };
    const out: string[] = [];
    createRoot(() => {
      const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
      const m1 = createMemo(() => ask("m1", 1 + m0()));
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => (reader === "m1()" ? String(m1()) : `${isPending(m1)},${m1()}`),
            v => void out.push(v)
          );
          return null;
        },
        () => "L"
      );
    });
    flush();
    await settle();
    expect(asks).toEqual(["m0:3", "m1:4"]);
    setS(2);
    await settle();
    await settle();
    expect(asks.slice(2)).toEqual(["m0:4", "m1:5", "m0:5", "m1:6"]);
    if (reader === "m1()") expect(out).toEqual(["4", "5", "6"]);
    else {
      expect(out[0]).toBe("false,4");
      expect(out[out.length - 1]).toBe("false,6");
      // Never final before `m1:6` lands.
      expect(out.slice(1, -1).every(v => v.startsWith("true,"))).toBe(true);
    }
  });
