import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const Other = _$$component(_REGISTRY, "Other", function Other() {
  return <A x={2} />;
}, {
  location: "src/merge-namespace-ts.tsx:13:7",
  signature: "9e0da269"
});
export function A(props: {
  x?: number;
}) {
  return <>{props.x ?? A.defaultX}</>;
}
export namespace A {
  export const defaultX = 1;
}
export { Other };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
