import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export let LetComp = _$$component(_REGISTRY, "LetComp", () => <div>let</div>, {
	location: "src/decl-kinds.jsx:1:21",
	signature: "d4e45462"
});
var VarComp = _$$component(_REGISTRY, "VarComp", (props) => <span>{props.x}</span>, {
	location: "src/decl-kinds.jsx:2:14",
	signature: "af220732"
});
const First = _$$component(_REGISTRY, "First", () => 1, {
	location: "src/decl-kinds.jsx:3:14",
	signature: "2e575e07"
}), second = 2, Third = _$$component(_REGISTRY, "Third", function Named() {
	return 3;
}, {
	location: "src/decl-kinds.jsx:5:10",
	signature: "65448e43"
});
export default function() {
	return <div>anon</div>;
}
export { VarComp };
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
