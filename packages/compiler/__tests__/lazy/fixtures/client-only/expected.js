import { clientOnly } from "@solidjs/web";
const Chart = clientOnly(() => import("./Chart"), void 0, "__SOLID_LAZY_MODULE__:./Chart");
const Map = clientOnly(() => import("./Map"), {
  lazy: true
}, "__SOLID_LAZY_MODULE__:./Map");
export function widgets() {
  const Inline = clientOnly(() => import("./Inline"), void 0, "__SOLID_LAZY_MODULE__:./Inline");
  return [Chart, Map, Inline];
}
const Annotated = clientOnly(() => import("./Annotated"), {
  lazy: true
}, "resolved");
