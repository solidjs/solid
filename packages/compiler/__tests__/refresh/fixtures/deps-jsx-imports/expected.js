import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const Local = _$$component(_REGISTRY, "Local", function Local() {
  return <div />;
}, {
  location: "src/deps-jsx-imports.jsx:13:7",
  signature: "475a05d5"
});
const Shadowed = _$$component(_REGISTRY, "Shadowed", function Shadowed() {
  const Widget = () => <span />;
  return <Widget />;
}, {
  location: "src/deps-jsx-imports.jsx:28:7",
  signature: "581ee8e6"
});
const App = _$$component(_REGISTRY, "App", function App() {
  return <Provider>
      <Local />
      <NS.Thing />
    </Provider>;
}, {
  location: "src/deps-jsx-imports.jsx:17:7",
  signature: "ea8ef26e",
  dependencies: () => ({
    Provider: Provider,
    NS: NS
  })
});
import { Provider, Widget } from "./context";
import * as NS from "./helpers";
export { Local };
export { App };
export { Shadowed };
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
