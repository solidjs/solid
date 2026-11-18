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
