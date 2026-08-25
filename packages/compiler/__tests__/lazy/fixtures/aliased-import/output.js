import { lazy as myLazy, Suspense as lazy } from "solid-js";
// Aliased local `myLazy` must NOT transform: the callee has to be spelled
// `lazy` (the Babel plugin matches the callee name before the binding).
const F = myLazy(() => import("./F"));
// ...while any solid-js named import locally called `lazy` matches.
const G = lazy(() => import("./G"), void 0, "__SOLID_LAZY_MODULE__:./G");
export { F, G };
