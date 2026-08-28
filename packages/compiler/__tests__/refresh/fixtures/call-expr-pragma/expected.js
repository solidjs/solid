import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { createButton, createBox } from "./factory";
const _REGISTRY = _$$registry();
export const Badge = _$$component(_REGISTRY, "Badge", createButton({
  color: "red"
}), {
  location: "src/call-expr-pragma.jsx:8:46",
  signature: "c24da47",
  dependencies: () => ({
    createButton: createButton
  })
});
export const Box = _$$component(_REGISTRY, "Box", createBox(), {
  location: "src/call-expr-pragma.jsx:11:19",
  signature: "59180972",
  dependencies: () => ({
    createBox: createBox
  })
});
export const Plain = createBox();
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
