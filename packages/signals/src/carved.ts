// CARVE (size/carve-step1, measurement branch — never merges).
//
// Names the carved capabilities used to export. The downstream dists
// (solid-js, @solidjs/web) re-export or import them by name, and Rolldown
// fails a bundle on a missing export, so each keeps a stub that throws. A
// stub is a plain function with no side effects: a scenario that never
// reaches one shakes it (0 B); one that does retains a few bytes, visible in
// the module inventory as `carved.js`.
const carved = (name: string) => (): never => {
  throw new Error(`[CARVED] ${name} was removed on the measurement branch`);
};

// ── store family (carve 1) — all back (plan sec. 31–35: S1 plain, S2 holds, S3
// projections/reconcile, S4 optimistic, S-U utils). ──────────────────────

// CARVE 2: verdict family — all back (`affects` the last, as ./affects.ts).

// CARVE 5 (plan sec. 28 replay): the lane layer — lanes.ts (`createOptimistic`'s
// write) and verdict.ts (`isPending`/`latest`) — carved and rebuilt from the
// plan sec. 28 principles (back: core/lanes.ts, core/verdict.ts).
