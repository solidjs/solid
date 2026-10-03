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

// ── store family (carve 1) — plain stores back (§31 S1); the rest return
// with S-U (utils), S3 (projection/reconcile) and S4 (optimistic). ────────
export const SOURCE_PLAIN = 0;
export const SOURCE_OMIT = 1;
export const SOURCE_PROXY = 2;
export const SOURCE_MEMO = 3;
export const SOURCE_MERGE = 4;
export const mergeSources = carved("mergeSources");
export const mergeView = carved("mergeView");
export const viewOf = carved("viewOf");
export const omitView = carved("omitView");
export const sourceKeys = carved("sourceKeys");
export const sourceHas = carved("sourceHas");
export const sourceGet = carved("sourceGet");
export const hasStaticKeys = carved("hasStaticKeys");
export const isStatic = carved("isStatic");
export const resolvedTable = carved("resolvedTable");
export const OmitView = carved("OmitView");
export const MergeView = carved("MergeView");
export const sourceOwners = carved("sourceOwners");
export const createOptimisticStore = carved("createOptimisticStore");
export const merge = carved("merge");
export const omit = carved("omit");

// CARVE 2: verdict family — all back (`affects` the last, as ./affects.ts).

// CARVE 5 (§28 replay): the lane layer — lanes.ts (`createOptimistic`'s
// write) and verdict.ts (`isPending`/`latest`) — carved and rebuilt from the
// §28 principles (back: core/lanes.ts, core/verdict.ts).
