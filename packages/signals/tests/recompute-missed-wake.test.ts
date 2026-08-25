import { createMemo, createRoot, createSignal, flush } from "../src/index.js";

/**
 * #3037 (engine half) — a dependency write that lands WHILE its subscriber is
 * mid-recompute must reschedule it. The write path marks the subscriber dirty,
 * but insertIntoHeap refuses RECOMPUTING nodes, and recompute's finally used
 * to wipe the mark — values read before the nested commit stayed served
 * forever (a silent, permanently-stale computed). The mark now survives the
 * pass and re-enters the heap at its tail.
 *
 * In the wild the mid-pass write comes from a nested pull: a projection
 * derive's read forces another projection's recompute, whose commit writes a
 * store key the outer derive already read this pass (solid-flow's first-edge
 * repro, browser-scheduling dependent). The direct write here pins the same
 * engine window deterministically.
 */
describe("mid-recompute dep writes reschedule the subscriber (#3037)", () => {
  it("re-runs a memo whose dep changed beneath its own pass", () => {
    createRoot(() => {
      const [s, setS] = createSignal(0, { ownedWrite: true });
      const [t] = createSignal("later-read");
      let runs = 0;
      const c = createMemo(() => {
        runs++;
        const v = s();
        // Move the pass past the `s` link: the latch deliberately ignores
        // writes landing on the TAIL link (that is the read in flight — a
        // nested pull's commit is returned fresh by that very read, see the
        // graph.test.ts new-dependencies ordering contract).
        void t();
        // Simulates the nested commit landing on the already-validated link.
        if (v === 0) setS(1);
        return v;
      });
      flush();
      expect(runs).toBe(2);
      expect(c()).toBe(1);
    });
  });

  it("settles without cascading when the mid-pass write is same-value", () => {
    createRoot(() => {
      const [s, setS] = createSignal(0, { ownedWrite: true });
      let runs = 0;
      const c = createMemo(() => {
        runs++;
        const v = s();
        setS(v); // same-value write: equality gate must stop any rescheduling
        return v;
      });
      flush();
      expect(runs).toBe(1);
      expect(c()).toBe(0);
    });
  });
});
