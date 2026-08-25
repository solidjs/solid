import { $$component as _$$component2 } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = "taken";
const _$$component = "also taken";
const _cleanup = "and this";
import { render } from "@solidjs/web";
const _cleanup2 = render(() => 1, el);
if (import.meta.hot) import.meta.hot.dispose(_cleanup2);
const _REGISTRY2 = _$$registry();
export const App = _$$component2(_REGISTRY2, "App", () => <div>{_REGISTRY}{_$$component}{_cleanup}</div>, {
	location: "src/uid-collisions.jsx:6:19",
	signature: "fc30a1b4",
	dependencies: () => ({
		_REGISTRY,
		_$$component,
		_cleanup
	})
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY2);
}
