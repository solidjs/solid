import { lazy } from "solid-js";
function scope() {
  const lazy = fn => fn;
  return lazy(() => import("./Shadowed"));
}
const D = lazy(() => import("./D"), void 0, "__SOLID_LAZY_MODULE__:./D");
export { scope, D };
