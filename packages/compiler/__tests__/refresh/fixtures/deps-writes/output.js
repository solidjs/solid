import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
let count = 0;
let obj = {};
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => {
	count++;
	obj.prop = count;
	const local = count + window.outer;
	return <div>{local}</div>;
}, {
	location: "src/deps-writes.jsx:3:19",
	signature: "6e4d3d91",
	dependencies: () => ({
		count,
		obj,
		window
	})
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
