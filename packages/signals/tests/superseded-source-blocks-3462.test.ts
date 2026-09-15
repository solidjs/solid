// #3462: a transaction blocked on a memo's flight must stay blocked while an
// upstream re-ask supersedes that flight. `transitionComplete` judged the
// source by its own flight alone (the self entry in `_pendingSources`); the
// re-ask retired that entry and left the source pending on the upstream
// flight, so a re-entry before the landing — a repeated same-value write to
// the held signal — found the transaction "complete" and committed
// `show = true` while the conditional reading `selected` still could not
// render (A15: async work observed by a reader settles as one unit with the
// writes that asked it).
import { describe, expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flush();
}
type Gate = { who: string; v: number; d: ReturnType<typeof deferred<number>> };

async function scenario(repeat: boolean) {
  const rendered: Record<string, unknown> = {};
  const frames: string[] = [];
  const gates: Gate[] = [];
  let setA!: (v: number) => void;
  let setB!: (v: number) => void;
  let setShow!: (v: boolean) => void;
  let dispose!: () => void;
  const land = (who: string, expectV: number) => {
    const i = gates.findIndex(g => g.who === who && g.v === expectV);
    expect(i).not.toBe(-1);
    const [g] = gates.splice(i, 1);
    g.d.resolve(g.v);
  };
  const snap = () => {
    const f = `${rendered.show} | ${rendered.panel}`;
    if (frames[frames.length - 1] !== f) frames.push(f);
  };
  createRoot(d => {
    dispose = d;
    const [a, sa] = createSignal(0);
    const [b, sb] = createSignal(0);
    const [show, ss] = createSignal(false);
    setA = sa;
    setB = sb;
    setShow = ss;
    const fetch = (who: string, v: number) => {
      const d = deferred<number>();
      gates.push({ who, v, d });
      return d.promise;
    };
    const details = createMemo(() => fetch("details", a()));
    const selected = createMemo(() => fetch("selected", a() + b() + details()));
    const c = createMemo(() => !!show());
    createRenderEffect(
      () => String(show()),
      v => void (rendered.show = v)
    );
    createRenderEffect(
      () => (c() ? selected() : "hidden"),
      v => void (rendered.panel = v)
    );
  });
  try {
    flush();
    land("details", 0);
    await settle();
    land("selected", 0);
    await settle();
    snap();
    expect(rendered).toEqual({ show: "false", panel: "hidden" });

    // b = 1 re-asks `selected` unobserved: no hold, the flight is in the air.
    setB(1);
    await settle();
    snap();
    // The reveal lands on the pending `selected`: show = true is held on it.
    setShow(true);
    await settle();
    snap();
    expect(rendered).toEqual({ show: "false", panel: "hidden" });
    // a = 1 re-asks `details`; `selected` is now pending on it (its own
    // flight superseded).
    setA(1);
    await settle();
    snap();
    if (repeat) {
      // The repeated write re-enters the held transaction: it must stay held.
      setShow(true);
      await settle();
      snap();
    }
    land("selected", 1); // the superseded flight's promise — ignored
    await settle();
    snap();
    land("details", 1);
    await settle();
    snap();
    land("selected", 3);
    await settle();
    await settle();
    snap();
    return frames;
  } finally {
    dispose();
  }
}

describe("A15 / #3462 a source pending on a superseding re-ask keeps blocking", () => {
  it("repeating the held write while the conditional's source is re-asked keeps it held", async () => {
    expect(await scenario(true)).toEqual(["false | hidden", "true | 3"]);
  });
  it("control: without the repeated write both publish at the chain's landing", async () => {
    expect(await scenario(false)).toEqual(["false | hidden", "true | 3"]);
  });
});
