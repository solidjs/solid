import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const A = _$$component(_REGISTRY, "A", function A() {
	return <>1</>;
}, {
	location: "src/merge-type-only.tsx:8:7",
	signature: "2005ca18"
});
const C = _$$component(_REGISTRY, "C", function C(x?: number) {
	return <>{x ?? 3}</>;
}, {
	location: "src/merge-type-only.tsx:21:7",
	signature: "d043ed29"
});
const B = _$$component(_REGISTRY, "B", function B() {
	return <>2</>;
}, {
	location: "src/merge-type-only.tsx:13:0",
	signature: "c9cdaf96"
});
// Type-only declaration merging (interfaces, type aliases, ambient
// namespaces, overload signatures) is erased by the TS strip, so
// same-name components still wrap — only *value* merges suppress the
// function-to-const rewrite.
export interface A {
	x: number;
}
export { A };
type B = string;
declare namespace C {
	const c: number;
}
export function C(x: number): any;
export { C };
console.log(B);
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
