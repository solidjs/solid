import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
import { withStyles, connect } from "./hoc";
// Frozen plugin behavior: an inline component inside an arbitrary HOC call
// is NOT registered (only TS wrappers like `as`/`!`/`satisfies` are peeled;
// see the ts-wrapped fixture). HMR for these relies on module invalidation.
export const Fancy = withStyles(() => <div class="fancy" />);
export const Chained = connect(withStyles((props) => <div>{props.x}</div>));
const _REGISTRY = _$$registry();
// A separately declared component is registered as usual, and the HOC call
// then closes over the registered binding.
const Plain = _$$component(_REGISTRY, "Plain", () => <p />, {
	location: "src/hoc-wrapped.jsx:10:14",
	signature: "c8587e3c"
});
export const Wrapped = withStyles(Plain);
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
