import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { createButton, createBox } from "./factory";
const _REGISTRY = _$$registry();
// #3090 (native-first divergence from the frozen Babel reference): the
// per-binding `@refresh component` pragma asserts a call-shaped binding is a
// component when no in-module JSX usage can prove it (export-only shapes).
// Init position (the shape from the issue).
export const Badge = _$$component(
	_REGISTRY,
	"Badge",
	/* @refresh component */
	createButton({ color: "red" }),
	{
		location: "src/call-expr-pragma.jsx:8:46",
		signature: "c24da47",
		dependencies: () => ({ createButton })
	}
);
// @refresh component
export const Box = _$$component(_REGISTRY, "Box", createBox(), {
	location: "src/call-expr-pragma.jsx:11:19",
	signature: "59180972",
	dependencies: () => ({ createBox })
});
// No pragma, no in-module render: stays bare.
export const Plain = createBox();
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
