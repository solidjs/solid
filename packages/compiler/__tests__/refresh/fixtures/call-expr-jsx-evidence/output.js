import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const Legend = _$$component(_REGISTRY, "Legend", function Legend() {
	return <p><Badge>in-module</Badge></p>;
}, {
	location: "src/call-expr-jsx-evidence.jsx:11:7",
	signature: "6a4fb4"
});
const Other = _$$component(_REGISTRY, "Other", function Other() {
	const Shadowed = local();
	return <div><Shadowed /></div>;
}, {
	location: "src/call-expr-jsx-evidence.jsx:15:7",
	signature: "a6932ee6",
	dependencies: () => ({ local })
});
import { styled, local } from "./styled";
// #3090 (native-first divergence from the frozen Babel reference): a
// call-shaped binding rendered as a JSX tag in THIS module is proven a
// component and registers like one — location, signature, dependencies.
export const Badge = _$$component(_REGISTRY, "Badge", styled.span.attrs({ title: "v1" })`color: red;`, {
	location: "src/call-expr-jsx-evidence.jsx:6:21",
	signature: "64082b40",
	dependencies: () => ({ styled })
});
// Never rendered here except through a shadowing local below: no evidence,
// stays bare (a `@refresh component` pragma would register it).
export const Shadowed = styled.div`color: blue;`;
export { Legend };
export { Other };
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
