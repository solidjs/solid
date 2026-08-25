import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import * as solid from "solid-js";
import { createContext } from "solid-js/web";
const _REGISTRY = _$$registry();
export const A = _$$component(_REGISTRY, "A", solid.createContext(0));
export const B = _$$component(_REGISTRY, "B", createContext({
  deep: [1, 2]
}));
function shadow() {
  const createContext = () => 1;
  return createContext();
}
const NotTop = _$$component(_REGISTRY, "NotTop", () => {
  const Inner = createContext(1);
  return Inner;
}, {
  location: "src/context-namespace.jsx:10:15",
  signature: "f16bc10e",
  dependencies: () => ({
    createContext: createContext
  })
});
export { shadow, NotTop };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
