import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => <ul data-x="dq" data-y="sq &amp; ent">
    {items.map((item) => <li key={item.id} style={{ color: "red" }}>
        {item.name} text &lt; entity
        <Nested.Deep.Comp {...item} />
        <>{/* fragment comment */}</>
      </li>)}
  </ul>, {
	location: "src/sig-jsx.jsx:1:19",
	signature: "721844ff",
	dependencies: () => ({
		items,
		Nested
	})
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
