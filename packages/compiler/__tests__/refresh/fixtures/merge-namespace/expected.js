import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const B = _$$component(_REGISTRY, "B", function B() {
  return <div>{A.a}</div>;
}, {
  location: "src/merge-namespace.jsx:14:0",
  signature: "e4c36071",
  dependencies: () => ({
    A: A
  })
});
function A() {
  return <>1</>;
}
(function (A) {
  A.a = 1;
})(A || (A = {}));
console.log(A, B);
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
