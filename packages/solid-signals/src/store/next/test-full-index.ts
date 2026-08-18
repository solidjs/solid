/**
 * Full-index alias shim: `vite.next.config.ts` maps the tests' import of
 * `src/index.js` here. Re-exports the entire real package surface, with the
 * rewrite's implementations shadowing (explicit exports win over `export *`).
 */
export * from "../../index.js";
export { createStore, reconcile, snapshot, deep } from "./dispatch.js";
// Bring-up surface: the gate config exercises next-native projections while
// the default build still routes them to legacy.
export { createProjectionNext as createProjection } from "./projection.js";
