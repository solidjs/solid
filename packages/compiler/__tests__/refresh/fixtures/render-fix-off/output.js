import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { render } from "@solidjs/web";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => <div />, {
	location: "src/render-fix-off.jsx:3:19",
	signature: "62028a8c"
});
render(() => <App />, document.body);
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
