import { lazyModule as loadModule, Suspense as lazyModule } from "solid-js";
// Aliased local must NOT transform: the callee has to be spelled `lazyModule`.
const skipped = loadModule(() => import("./Skip"));
// Any solid-js named import locally called `lazyModule` matches.
const matched = lazyModule(() => import("./Match"), "__SOLID_LAZY_MODULE__:./Match");
export { skipped, matched };
