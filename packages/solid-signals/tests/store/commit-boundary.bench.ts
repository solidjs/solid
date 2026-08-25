// Commit-boundary micro-bench (#3044 repro shape): a flush after every
// two-key setter on an unsubscribed store. Nothing amortizes here — each
// commit pays the full fixed cost (pending-overlay allocation, fold,
// notify sweep), so this pins the per-commit floor. rc.1 shipped a 250x
// regression on exactly this shape (O(container) clones per flush); the
// prototype-overlay work brought it back to the legacy-store floor
// (~1.3us/commit). Guard both directions: the per-commit pattern AND the
// batched pattern (same writes, one commit) whose per-write cost should
// stay at raw-write parity.
import { bench } from "vitest";
import { createStore, flush } from "../../src/index.js";

const COMMITS = 500;

bench("commit boundary: flush after every 2-key setter, no subscribers (#3044)", () => {
  // Fresh store per invocation: the shape grows keys monotonically, so
  // reusing state across invocations would measure ever-larger objects.
  const [, setStore] = createStore<Record<number, boolean>>({});
  for (let i = 1; i < COMMITS; i++) {
    setStore(s => {
      s[i - 1] = false;
      s[i] = true;
    });
    flush();
  }
});

bench("batched: same writes, single commit", () => {
  const [, setStore] = createStore<Record<number, boolean>>({});
  setStore(s => {
    for (let i = 1; i < COMMITS; i++) {
      s[i - 1] = false;
      s[i] = true;
    }
  });
  flush();
});
