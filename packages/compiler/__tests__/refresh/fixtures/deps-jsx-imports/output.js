import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
const Local = _$$component(_REGISTRY, "Local", function Local() {
	return <div />;
}, {
	location: "src/deps-jsx-imports.jsx:13:7",
	signature: "475a05d5"
});
const Shadowed = _$$component(_REGISTRY, "Shadowed", function Shadowed() {
	// Shadowing local resolves first: not a module-scope dependency.
	const Widget = () => <span />;
	return <Widget />;
}, {
	location: "src/deps-jsx-imports.jsx:28:7",
	signature: "581ee8e6"
});
const App = _$$component(_REGISTRY, "App", function App() {
	// Provider: imported, JSX-tag-only -> counts. Local: same-module -> not.
	// NS: member-expression root -> counts (unchanged behavior).
	return <Provider>
      <Local />
      <NS.Thing />
    </Provider>;
}, {
	location: "src/deps-jsx-imports.jsx:17:7",
	signature: "ea8ef26e",
	dependencies: () => ({
		Provider,
		NS
	})
});
// Deliberate divergence from the Babel plugin (which skips all plain JSX
// identifier tags): an *imported* binding referenced only as a JSX tag must
// appear in `dependencies`, or granular HMR keeps rendering the stale module
// instance after an edit bubbles from the imported module (split-brain:
// sibling non-JSX references swap to the new instance while the tag stays
// old — reproduced as a ContextNotFoundError with a re-created context).
// Same-module component tags stay excluded: their `$$component` proxy gets a
// new identity on every re-execution, so counting them would remount
// everything on every edit.
import { Provider, Widget } from "./context";
import * as NS from "./helpers";
export { Local };
export { App };
export { Shadowed };
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
