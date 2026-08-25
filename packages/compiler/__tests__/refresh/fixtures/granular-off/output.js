import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { createSignal } from "solid-js";
const _REGISTRY = _$$registry();
export const Counter = _$$component(_REGISTRY, "Counter", () => {
	const [count, setCount] = createSignal(0);
	return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
}, { location: "src/granular-off.jsx:3:23" });
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
