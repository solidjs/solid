import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const A3 = _$$component(_REGISTRY, "A3", function A3() {
  return before;
}, {
  location: "src/bubbling.jsx:2:7",
  signature: "6d597678",
  dependencies: () => ({
    before: before
  })
});
const D3 = _$$component(_REGISTRY, "D3", function D3() {
  return after;
}, {
  location: "src/bubbling.jsx:13:7",
  signature: "a9178b81",
  dependencies: () => ({
    after: after
  })
});
const C3 = _$$component(_REGISTRY, "C3", function C3() {
  return 3;
}, {
  location: "src/bubbling.jsx:9:15",
  signature: "3383845c"
});
const B3 = _$$component(_REGISTRY, "B3", function B3() {
  return mid;
}, {
  location: "src/bubbling.jsx:6:0",
  signature: "6e049980",
  dependencies: () => ({
    mid: mid
  })
});
const before = 1;
export { A3 };
const mid = 2;
export default C3;
const after = 3;
export { D3 };
export { B3 };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
