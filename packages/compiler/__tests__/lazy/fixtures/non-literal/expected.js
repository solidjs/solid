import { lazy } from "solid-js";
const H = lazy(() => import(path));
const I = lazy(() => import(`./I`));
const J = lazy(() => import("./J", {
  with: {
    type: "json"
  }
}));
const K = lazy(() => somethingElse("./K"));
const L = lazy(async () => await import("./L"));
const M = lazy();
const N = lazy(() => import("./N"), void 0, "resolved");
export { H, I, J, K, L, M, N };
