/**
 * Isolation guard (architecture audit, Tier-1 PR).
 *
 * The Sierpinski example — and fine-grained reactivity generally — depends on
 * an update recomputing ONLY the nodes whose inputs actually changed. This has
 * regressed before via changes that widened propagation, and it is a
 * deterministic recompute-COUNT invariant, independent of timing (so it guards
 * the isolation property that CodSpeed's propagation:* benches measure by
 * time). Counts here are exact for the current propagation algorithm; a change
 * that recomputes extra nodes — or fails to recompute a changed one — moves
 * them and fails loudly.
 */
import { createMemo, createRoot, createSignal, flush } from "../src/index.js";

describe("propagation isolation (recompute counts)", () => {
  it("avoidable: downstream memos skip when the derived input is unchanged", () => {
    let parityRuns = 0;
    const leafRuns: number[] = [];
    const FANOUT = 8;
    let setSource!: (value: number) => number;

    createRoot(() => {
      const [source, set] = createSignal(0);
      setSource = set;
      const parity = createMemo(() => {
        parityRuns++;
        return source() & 1;
      });
      for (let i = 0; i < FANOUT; i++) {
        leafRuns[i] = 0;
        createMemo(() => {
          leafRuns[i]++;
          return parity();
        });
      }
    });
    flush();

    // Initial: parity + every leaf ran once.
    expect(parityRuns).toBe(1);
    expect(leafRuns).toEqual(Array(FANOUT).fill(1));

    // Update by +2: parity recomputes but its VALUE is unchanged (& 1), so
    // no leaf may re-run. This is the avoidable-propagation isolation.
    flush(() => setSource(2));
    expect(parityRuns).toBe(2);
    expect(leafRuns).toEqual(Array(FANOUT).fill(1));

    // Update by +1: parity value flips, every leaf re-runs exactly once.
    flush(() => setSource(3));
    expect(parityRuns).toBe(3);
    expect(leafRuns).toEqual(Array(FANOUT).fill(2));
  });

  it("diamond: the join recomputes once per settled update, not per branch", () => {
    let joinRuns = 0;
    let setSource!: (value: number) => number;

    createRoot(() => {
      const [source, set] = createSignal(0);
      setSource = set;
      const left = createMemo(() => source() + 1);
      const right = createMemo(() => source() + 2);
      createMemo(() => {
        joinRuns++;
        return left() + right();
      });
    });
    flush();
    expect(joinRuns).toBe(1); // initial

    // One source change fans through both branches but the join settles once
    // (no glitch, no double-run) — the classic isolation property.
    flush(() => setSource(1));
    expect(joinRuns).toBe(2);
  });
});
