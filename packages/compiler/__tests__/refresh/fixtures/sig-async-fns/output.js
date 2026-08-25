import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => {
	const f = async () => await fetch(url);
	const g = async function inner() {
		return await a + await b * c;
	};
	function* gen() {
		const x = yield a;
		yield* b;
	}
	return [
		f,
		g,
		gen
	];
}, {
	location: "src/sig-async-fns.jsx:1:19",
	signature: "a943a45d",
	dependencies: () => ({
		fetch,
		url,
		a,
		b,
		c
	})
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
