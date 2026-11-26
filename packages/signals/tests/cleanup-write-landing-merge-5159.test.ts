/**
 * #5159 — the merge form of #4089. A landing's commits dispose an old child
 * whose cleanup writes a node another live transaction holds (the flush
 * joins it) and a node the landing still holds. Joining the landed
 * transaction merged it: `merge` spliced `transactions.indexOf(landed)`,
 * -1, and evicted the last live transaction, whose verdict never cleared.
 * In the reverse order the flush parked in the landed transaction and the
 * live one folded into it. A landed transaction holds nothing: the write is
 * the landing's own (D-9, A15).
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  onCleanup
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await tick();
    flush();
  }
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function run(mode: "control" | "held-first" | "slot-first") {
  const chunk = deferred<string>();
  const pageData = deferred<string>();
  const bData = deferred<string>();
  const cData = deferred<string>();
  const [route, setRoute] = createSignal("old");
  const [slot, setSlot] = createSignal("old-header", { ownedWrite: true });
  const [b, setB] = createSignal("b0");
  const [b2, setB2] = createSignal("x0", { ownedWrite: true });
  const [c, setC] = createSignal("c0");
  const shown: Record<string, string> = {};
  const dispose = createRoot(dispose => {
    const component = createMemo(() => (route() === "new" ? chunk.promise : "OldPage"));
    const data = createMemo(() => (component() === "NewPage" ? pageData.promise : "old-data"));
    const page = createMemo(() => {
      if (component() === "OldPage") {
        onCleanup(() => {
          if (mode === "control") return;
          const clearSlot = () => setSlot(cur => (cur === "old-header" ? "" : cur));
          if (mode === "slot-first") clearSlot();
          setB2("x-from-cleanup");
          if (mode === "held-first") clearSlot();
        });
        return "old";
      }
      setSlot("new-header");
      return `new:${data()}`;
    });
    createRenderEffect(page, v => void (shown.page = v));
    createRenderEffect(slot, v => void (shown.slot = v));
    const bView = createMemo(() => (b() === "b1" ? bData.promise : `data-${b()}`));
    createRenderEffect(
      () => [b2(), bView()] as const,
      ([x, v]) => {
        shown.b2 = x;
        shown.b = v;
      }
    );
    createEffect(
      () => isPending(() => bView()),
      v => void (shown.bPending = String(v))
    );
    const cView = createMemo(() => (c() === "c1" ? cData.promise : `data-${c()}`));
    createRenderEffect(cView, v => void (shown.c = v));
    createEffect(
      () => isPending(() => cView()),
      v => void (shown.cPending = String(v))
    );
    return dispose;
  });
  flush();
  setB("b1"); // T2
  setB2("x1");
  flush();
  await settle();
  setC("c1"); // T3, last in the live list
  flush();
  await settle();
  setRoute("new"); // T1
  flush();
  await settle();
  chunk.resolve("NewPage");
  await settle();
  pageData.resolve("new-data"); // T1 lands
  await settle();
  const whileT2Open = { b: shown.b, b2: shown.b2 };
  bData.resolve("b1-data");
  cData.resolve("c1-data");
  await settle();
  dispose();
  return { whileT2Open, shown };
}

describe("#5159 a cleanup during a landing never evicts or folds another transaction", () => {
  for (const mode of ["control", "held-first", "slot-first"] as const) {
    it(mode, async () => {
      const { whileT2Open, shown } = await run(mode);
      // T2 is still waiting on its data when T1 lands: none of its writes show.
      expect(whileT2Open).toEqual({ b: "data-b0", b2: "x0" });
      expect(shown).toEqual({
        page: "new:new-data",
        slot: "new-header",
        b: "b1-data",
        b2: mode === "control" ? "x1" : "x-from-cleanup",
        bPending: "false",
        c: "c1-data",
        cPending: "false"
      });
    });
  }
});
