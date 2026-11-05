// #4677: an async memo that reads `id()` and `isPending(id)` is a verdict
// reader (D-25: the probe decides the pass's posture), so its async opens a
// lane of its own (F-6). While its flight is up, the verdict binding and
// everything rendered from it wait together; at the lane's landing they
// reveal together, ahead of the parent when the lane lands first. The parent
// (the write to `id`) waits for the lane's flight, and when its landing has
// the badge re-derive onto a new flight, the landing's other runs park with
// that flight and show with it (U-5, D-9). F-1 holds throughout: no
// derivation ahead of its input, no verdict-derived value beside a verdict
// that disagrees with it.
//
// Two orders:
// 1. The issue's repro: details (the parent's own async) lands before the
//    badge's lane flight. The lane lands in the same seam the parent commits
//    in, whose landing voided the verdict binding's lane run: `pending: true`
//    showed on the badge while the binding stayed `false` (the lane split:
//    F-6, F-1). The lane reveals whole (`Pending true` beside the badge's
//    `true`), then everything at the badge's re-derived landing (lanes.ts
//    `laneSeam`).
// 2. The badge's lane flight lands first (it reveals whole); then details
//    lands, the parent commits and the badge re-derives onto a new flight.
//    The landing flush's own run (details) showed `Item 1` beside `id: 0`
//    (F-1, F-7) while the held runs parked with the re-derivation (U-5). The
//    flush's runs of effects that derive plainly from the landing wait with
//    the held runs (lanes.ts `landing`); what derives from a verdict reader
//    still shows now (#4398, `latest-first-one-pass-4402.test.ts`).
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

function setup(between = false) {
  const [id, setId] = createSignal(0);
  const details: Array<() => void> = [];
  const badges: Array<() => void> = [];
  const screen = { id: "", details: "", pending: "", badge: "" };
  const frames: string[] = [];
  const dispose = createRoot(dispose => {
    const detailsMemo = createMemo(() => {
      const i = id();
      if (i === 0) return "Item 0";
      return new Promise<string>(r => details.push(() => r(`Item ${i}`)));
    });
    const badge = createMemo(() => {
      const i = id();
      const p = isPending(id);
      const text = `ID: ${i}, pending: ${p}`;
      if (i === 0 && !p) return text;
      return new Promise<string>(r => badges.push(() => r(text)));
    });
    const bind = (k: keyof typeof screen, fn: () => unknown) =>
      createRenderEffect(fn, v => {
        screen[k] = String(v);
      });
    bind("id", id);
    // A plain memo between the landed node and its binding: still the
    // landing's frame.
    bind("details", between ? createMemo(() => `${detailsMemo()}`) : detailsMemo);
    bind("pending", () => isPending(id));
    bind("badge", badge);
    return dispose;
  });
  flush();
  const frame = () =>
    `id ${screen.id} | ${screen.details} | pending ${screen.pending} | ${screen.badge}`;
  const snap = () => frames.push(frame());
  return { setId, details, badges, frames, snap, dispose };
}

describe("#4677 isPending beside an async memo derived from it", () => {
  it("baseline: the badge's lane flight lands first and reveals whole", async () => {
    const t = setup();
    t.snap();
    t.setId(1);
    flush();
    t.snap();
    t.badges.shift()!();
    await tick();
    t.snap();
    expect(t.frames).toEqual([
      "id 0 | Item 0 | pending false | ID: 0, pending: false",
      "id 0 | Item 0 | pending false | ID: 0, pending: false",
      "id 0 | Item 0 | pending true | ID: 0, pending: true"
    ]);
    t.dispose();
  });

  it("the issue's order: details lands, then the lane — the lane reveals whole", async () => {
    const t = setup();
    t.setId(1);
    flush();
    t.details.shift()!();
    await tick();
    t.snap();
    t.badges.shift()!();
    await tick();
    t.snap();
    t.badges.shift()!();
    await tick();
    t.snap();
    expect(t.frames).toEqual([
      // details landed; the parent waits for the lane's flight (F-6)
      "id 0 | Item 0 | pending false | ID: 0, pending: false",
      // the lane lands: the verdict and its derivation reveal together
      "id 0 | Item 0 | pending true | ID: 0, pending: true",
      // the badge's re-derivation lands with the parent's frame (U-5)
      "id 1 | Item 1 | pending false | ID: 1, pending: false"
    ]);
    t.dispose();
  });

  it.each([false, true])(
    "the lane first, then details: no derivation shows ahead of `id` (memo between: %s)",
    async between => {
      const t = setup(between);
      t.setId(1);
      flush();
      t.badges.shift()!();
      await tick();
      t.details.shift()!();
      await tick();
      t.snap();
      t.badges.shift()!();
      await tick();
      t.snap();
      expect(t.frames).toEqual([
        // the parent's landing parks with the badge's re-derivation (U-5)
        "id 0 | Item 0 | pending true | ID: 0, pending: true",
        "id 1 | Item 1 | pending false | ID: 1, pending: false"
      ]);
      t.dispose();
    }
  );
});
