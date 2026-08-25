import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(
	_REGISTRY,
	"App",
	/* lead */
	() => {
		// one
		// two
		/* own line */
		first();
		/* pre */ second();
		return 1;
	},
	{
		location: "src/sig-comments.jsx:1:30",
		signature: "12c13ec1",
		dependencies: () => ({
			first,
			second
		})
	}
);
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
