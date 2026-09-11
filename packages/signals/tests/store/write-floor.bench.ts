// Per-write floor of narrow stores (#3360 repro shape): one root key written
// per store, one flush, no subscribers — the cost is pure draft/commit
// bookkeeping. rc.7 paid a descriptor clone (or, over an owned backing, a
// prototype overlay whose flatten wrote into a V8 prototype) plus a
// privatizing clone at the first commit; narrow plain containers now clone by
// spread and swap the clone in. The steady-state case is the number to watch;
// the fresh-store case covers the reporter's exact benchmark.
import { bench, describe } from "vitest";
import { createStore, flush } from "../../src/index.js";

const N = 2000;

describe(`${N} one-key stores, one write each per commit`, () => {
  const stores = Array.from({ length: N }, () => createStore({ value: 0 }));
  for (const [, set] of stores)
    set(d => {
      d.value = -1;
    });
  flush();
  let tick = 0;

  bench("steady state: owned backings (#3360)", () => {
    const v = ++tick;
    for (let i = 0; i < N; i++)
      stores[i][1](d => {
        d.value = v;
      });
    flush();
  });

  bench("fresh stores: create + first write + first commit (reporter shape)", () => {
    const fresh = Array.from({ length: N }, () => createStore({ value: 0 }));
    for (let i = 0; i < N; i++)
      fresh[i][1](d => {
        d.value = 1;
      });
    flush();
  });
});
