import { lazyModule as loadModule, Suspense as lazyModule } from "solid-js";
const skipped = loadModule(() => import("./Skip"));
const matched = lazyModule(() => import("./Match"), "__SOLID_LAZY_MODULE__:./Match");
export { skipped, matched };
