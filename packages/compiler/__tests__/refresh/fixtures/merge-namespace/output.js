import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const B = _$$component(_REGISTRY, "B", function B() {
	return <div>{A.a}</div>;
}, {
	location: "src/merge-namespace.jsx:14:0",
	signature: "e4c36071",
	dependencies: () => ({ A })
});
// solid-refresh#76 / vite-plugin-solid#145: the post-tsc-strip shape of
// `function A() {}` merged with `namespace A { ... }` — the namespace
// lowers to an IIFE that reads and conditionally assigns the function
// binding, so rewriting the declaration into `const A = $$component(...)`
// would break the merge. `A` stays untouched; the plain component `B`
// still wraps.
function A() {
	return <>1</>;
}
(function(A) {
	A.a = 1;
})(A || (A = {}));
console.log(A, B);
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
