// Projection root-write micro-bench (#3352 repro shape): a derive over a
// wide keyed record that touches ONE root key per recompute. Before the
// overlay path covered families, every recompute's first root-level write
// cloned the whole raw (O(keys) — ~17ms per derive at 20k keys); the plain
// store doing the identical root delete + set was already O(1) via the
// #3044 prototype overlay. Guard the parity: the projection derive and the
// store setter should sit at the same per-commit floor, and the nested
// write (a small target — always cheap) is the reference.
import { bench, describe } from "vitest";
import { createProjection, createRoot, createSignal, createStore, flush } from "../../src/index.js";

const KEYS = 20_000;
const seed = () => Object.fromEntries(Array.from({ length: KEYS }, (_, i) => [`k${i}`, { n: i }]));

describe(`one root key per commit, ${KEYS}-key record`, () => {
  // Fixtures are built once and reused: the shape is a long-lived record
  // (the reporter's model), so the steady state IS the measurement — the
  // one-time seed privatization is warmed out in setup.
  let tick = 0;
  let bump!: (n: number) => void;
  let bumpNested!: (n: number) => void;
  let setStore!: (fn: (d: Record<string, { n: number }>) => void) => void;
  createRoot(() => {
    const [t, setT] = createSignal(0, { ownedWrite: true });
    const proj = createProjection<Record<string, { n: number }>>(
      draft => {
        const i = t() % KEYS;
        delete draft[`k${i}`];
        draft[`k${i}`] = { n: -i };
      },
      seed(),
      { key: null }
    );
    void proj.k0;
    flush();
    bump = setT;

    const [t2, setT2] = createSignal(0, { ownedWrite: true });
    const nested = createProjection<Record<string, { n: number }>>(
      draft => {
        const i = t2() % KEYS;
        draft[`k${i}`].n = -i;
      },
      seed(),
      { key: null }
    );
    void nested.k0;
    flush();
    bumpNested = setT2;

    const [store, set] = createStore<Record<string, { n: number }>>(seed());
    void store.k0;
    set(d => {
      d.k0 = { n: -1 };
    });
    flush();
    setStore = set;
  });

  bench("projection derive: delete + set one ROOT key (#3352)", () => {
    bump(++tick);
    flush();
  });

  bench("projection derive: write one NESTED field (reference)", () => {
    bumpNested(++tick);
    flush();
  });

  bench("createStore setter: delete + set one root key (#3044 overlay)", () => {
    const i = ++tick % KEYS;
    setStore(d => {
      delete d[`k${i}`];
      d[`k${i}`] = { n: -i };
    });
    flush();
  });
});
