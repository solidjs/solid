/**
 * Full-index alias shim: `vite.next.config.ts` maps the tests' import of
 * `src/index.js` here. Re-exports the entire real package surface, with the
 * rewrite's implementations shadowing (explicit exports win over `export *`).
 */
export * from "../../index.js";
export { createStore, reconcile, snapshot, deep } from "./dispatch.js";
