import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const Cast = _$$component(_REGISTRY, "Cast", props => <div />, {
  location: "src/ts-wrapped.tsx:1:21",
  signature: "d5cbec78"
});
export const NonNull = _$$component(_REGISTRY, "NonNull", props => <div />, {
  location: "src/ts-wrapped.tsx:2:24",
  signature: "d5cbec78"
});
export const Satisfied = _$$component(_REGISTRY, "Satisfied", props => <div />, {
  location: "src/ts-wrapped.tsx:3:26",
  signature: "d5cbec78"
});
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
