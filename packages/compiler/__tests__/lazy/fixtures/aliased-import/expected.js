import { lazy as myLazy, Suspense as lazy } from "solid-js";
const F = myLazy(() => import("./F"));
const G = lazy(() => import("./G"), void 0, "__SOLID_LAZY_MODULE__:./G");
export { F, G };
