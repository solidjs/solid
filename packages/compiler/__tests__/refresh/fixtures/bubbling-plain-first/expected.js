import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const C5 = _$$component(_REGISTRY, "C5", function C5() {
  return 3;
}, {
  location: "src/bubbling-plain-first.jsx:7:7",
  signature: "15cf3b5c"
});
const B5 = _$$component(_REGISTRY, "B5", function B5() {
  return 2;
}, {
  location: "src/bubbling-plain-first.jsx:4:7",
  signature: "3b7586b9"
});
const A5 = _$$component(_REGISTRY, "A5", function A5() {
  return 1;
}, {
  location: "src/bubbling-plain-first.jsx:1:0",
  signature: "6a55c9d8"
});
export { B5 };
export { C5 };
export { A5 };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
