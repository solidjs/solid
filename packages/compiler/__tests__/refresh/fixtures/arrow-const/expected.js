import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { createSignal } from "solid-js";
import { theme } from "./theme";
const _REGISTRY = _$$registry();
export const Counter = _$$component(_REGISTRY, "Counter", () => {
  const [count, setCount] = createSignal(0);
  return <button style={theme.button} onClick={() => setCount(count() + 1)}>{count()}</button>;
}, {
  location: "src/arrow-const.jsx:4:23",
  signature: "9a688440",
  dependencies: () => ({
    createSignal: createSignal,
    theme: theme
  })
});
const Local = _$$component(_REGISTRY, "Local", props => <span>{props.children}</span>, {
  location: "src/arrow-const.jsx:9:14",
  signature: "9778088e"
});
export const Alias = Local;
export { Local };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
