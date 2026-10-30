import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const Component = _$$component(_REGISTRY, "Component", function Component(props) {
  return <div>{Variadic(1, 2, 3).length}</div>;
}, {
  location: "src/variadic-functions.jsx:8:7",
  signature: "6d231955",
  dependencies: () => ({
    Variadic: Variadic
  })
});
export function Variadic(...args) {
  return args;
}
export const VariadicArrow = (...args) => args.length;
export const VariadicExpression = function (...args) {
  return args[0];
};
export { Component };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
