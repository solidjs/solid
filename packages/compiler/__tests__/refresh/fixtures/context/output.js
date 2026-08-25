import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { createContext, createSignal } from "solid-js";
const _REGISTRY = _$$registry();
export const ThemeContext = _$$component(_REGISTRY, "ThemeContext", createContext({ theme: "light" }));
const InternalContext = _$$component(_REGISTRY, "InternalContext", createContext());
// Non-componentish name still registers (createContext is matched by callee).
const lower_ctx = _$$component(_REGISTRY, "lower_ctx", createContext(1));
// Not createContext: untouched.
export const S = createSignal(0);
export { InternalContext, lower_ctx };
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
