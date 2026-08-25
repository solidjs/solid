import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const App = _$$component(_REGISTRY, "App", function App() {
  const [count, setCount] = createSignal(0);
  const inc = () => setCount(count() + 1);
  if (count() > LIMIT) console.log("big");
  return <button onClick={inc}>{count()}</button>;
}, {
  location: "src/function-component.jsx:5:15",
  signature: "4101e1be",
  dependencies: () => ({
    createSignal: createSignal,
    LIMIT: LIMIT,
    console: console
  })
});
import { createSignal } from "solid-js";
const LIMIT = 10;
export default App;
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
