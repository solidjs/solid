import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
export const VERSION = "1.0";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => <div>{VERSION}</div>, {
	location: "src/mixed-exports.jsx:2:19",
	signature: "6cf5b093",
	dependencies: () => ({ VERSION })
});
export function helper() {
	return 1;
}
export const config = { deep: true };
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
