/**
 * #2927: an unobserved memo (no effect / render read) interleaved with
 * `latest(m)` reads and `equals: false` same-value writes permanently stopped
 * re-running on 2.0.0-beta.21 — in BOTH orderings (`m(); latest(m)` and
 * `latest(m); m()`), despite the reporter only seeing one of them stall.
 *
 * The stall was fixed incidentally by the affects()-dedicated-channel
 * refactor that deleted stashedOptimisticReads (c04931ba); this test pins the
 * scenario so it cannot regress. The memo has no observers, so each click's
 * reads are the only demand — every click after a write must recompute.
 */
import { createMemo, createRoot, createSignal, flush, latest } from "../src/index.js";

function setup() {
  let runs = 0;
  let m!: () => number;
  let s!: (v: number) => void;
  createRoot(() => {
    const [g, set] = createSignal(0, { equals: false });
    s = set;
    m = createMemo(() => {
      runs++;
      return g() + 1;
    }) as any;
  });
  flush();
  return { m, write: () => s(0), runs: () => runs };
}

it("m(); latest(m); write — recomputes on every click (#2927 case A)", () => {
  const { m, write, runs } = setup();
  expect(runs()).toBe(1);
  for (let i = 2; i <= 5; i++) {
    m();
    latest(m as any);
    write();
    flush();
    expect(runs()).toBe(i);
  }
});

it("latest(m); m(); write — recomputes on every click (#2927 case B)", () => {
  const { m, write, runs } = setup();
  expect(runs()).toBe(1);
  for (let i = 2; i <= 5; i++) {
    latest(m as any);
    m();
    write();
    flush();
    expect(runs()).toBe(i);
  }
});

it("orderings stay consistent without explicit flushes (#2927)", () => {
  // Reads happen before the write within each click, so the recompute for a
  // write lands on the NEXT click's reads — a one-click lag, never a stall.
  const a = setup();
  const b = setup();
  for (let i = 0; i < 4; i++) {
    a.m();
    latest(a.m as any);
    a.write();

    latest(b.m as any);
    b.m();
    b.write();

    expect(a.runs()).toBe(b.runs());
    expect(a.runs()).toBe(Math.max(1, i + 1));
  }
});
