import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const s = "héllo 🎉 wörld";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => <div>{s}</div>, {
	location: "src/multibyte.jsx:2:19",
	signature: "6a48e475",
	dependencies: () => ({ s })
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
