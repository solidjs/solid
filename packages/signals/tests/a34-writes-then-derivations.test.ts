// A34 as amended 2026-10-01 (#3733, rule B; core R31): writes apply first,
// then derivations re-run. A manual write to a writable memo stages like any
// write; when a source changes — in the write's own flush or later, under a
// hold or on mainline — the derivation re-runs with the staged write as `prev`
// and decides what to keep. The write never refuses the re-run (a refresh
// included) and on its own never causes one. Under a transaction the re-run
// happens under it and reveals with it. A second write to the node is still
// (1)'s last-write-wins. Reverses #2692's "write trumps derivation on the same
// tick" (beta.11) and supersedes the frame-scoped mask of #3740: within a
// flush, call order is not observable, so "the write wins" only looked like an
// ordering rule. An override that must survive a source change is carried in
// the data, as something the derivation honors.

import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh,
  type Refreshable
} from "../src/index.js";

async function settled() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

function fixture(
  hold = false,
  derive: (prev: number | undefined, a: number) => number = (_, a) => a * 100
) {
  const [a, setA] = createSignal(1);
  let resolve!: (v: number) => void;
  const views: string[] = [];
  let b!: Refreshable<() => number>;
  let setB!: (v: number | ((p: number) => number)) => void;
  const dispose = createRoot(d => {
    [b, setB] = createSignal<number>(prev => derive(prev, a()));
    // The observer that holds `a` while `c` is in flight.
    const c = createMemo(() => (hold && a() !== 1 ? new Promise<number>(r => (resolve = r)) : a()));
    createRenderEffect(
      () => `a=${a()} b=${b()} c=${c()}`,
      v => void views.push(v)
    );
    return d;
  });
  flush();
  return { a, setA, b, setB, views, dispose, land: (v: number) => (resolve(v), settled()) };
}

describe("A34 rule B — writes apply first, then derivations re-run", () => {
  it("a write on its own never re-runs the derivation", () => {
    const f = fixture();
    f.setB(101);
    flush();
    expect(f.views.at(-1)).toBe("a=1 b=101 c=1");
    f.setB(101);
    flush();
    expect(f.views.at(-1)).toBe("a=1 b=101 c=1");
    f.dispose();
  });

  it("a source change in the same flush re-derives with the write as prev, either order", () => {
    const f = fixture();
    f.setA(2);
    f.setB(101);
    flush();
    expect(f.views.at(-1)).toBe("a=2 b=200 c=2");
    f.setB(7);
    f.setA(3);
    flush();
    expect(f.views.at(-1)).toBe("a=3 b=300 c=3");
    f.dispose();
  });

  it("a source change in a later frame re-derives the same way", () => {
    const f = fixture();
    f.setB(101);
    flush();
    expect(f.b()).toBe(101);
    f.setA(3);
    flush();
    expect(f.views.at(-1)).toBe("a=3 b=300 c=3");
    f.dispose();
  });

  it("the derivation decides what to keep: a prev-reading fold honors the write", () => {
    const f = fixture(false, (prev, a) => Math.max(prev ?? 0, a * 100));
    f.setB(1000);
    f.setA(2);
    flush();
    expect(f.views.at(-1)).toBe("a=2 b=1000 c=2");
    f.setA(20);
    flush();
    expect(f.views.at(-1)).toBe("a=20 b=2000 c=20");
    f.dispose();
  });

  it("among writes, last write wins; the re-run then takes the last as prev", () => {
    const f = fixture(false, (prev, a) => Math.max(prev ?? 0, a * 100));
    f.setA(2);
    f.setB(500);
    f.setB(300);
    flush();
    expect(f.views.at(-1)).toBe("a=2 b=300 c=2");
    f.dispose();
  });

  it("refresh() in the write's frame re-asks with the write as prev", () => {
    const f = fixture();
    f.setB(101);
    refresh(f.b);
    flush();
    expect(f.b()).toBe(100);
    f.setB(101);
    flush();
    expect(f.b()).toBe(101);
    refresh(f.b);
    flush();
    expect(f.b()).toBe(100);
    f.dispose();
  });

  it("inside a hold: the write joins; a source change in its own frame or a later one re-runs under the transaction and reveals with it (#3733)", async () => {
    const f = fixture(true);
    f.setA(2); // held: c in flight
    flush();
    expect(f.views).toEqual(["a=1 b=100 c=1"]);

    f.setB(101); // joins the hold, nothing shows
    flush();
    expect(f.views).toEqual(["a=1 b=100 c=1"]);

    f.setA(3); // the derivation runs again under the hold
    flush();
    expect(f.views).toEqual(["a=1 b=100 c=1"]);

    await f.land(3);
    expect(f.views.at(-1)).toBe("a=3 b=300 c=3");
    f.dispose();
  });

  it("inside a hold, the same frame: the write and the source change reveal as one re-derived frame", async () => {
    const f = fixture(true);
    f.setA(2);
    f.setB(101);
    flush();
    expect(f.views).toEqual(["a=1 b=100 c=1"]);
    await f.land(2);
    expect(f.views.at(-1)).toBe("a=2 b=200 c=2");
    f.dispose();
  });
});
