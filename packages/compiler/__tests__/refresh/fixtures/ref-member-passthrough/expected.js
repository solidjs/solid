import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const InlineTextArea = _$$component(_REGISTRY, "InlineTextArea", props => {
  return <input ref={props.setRef} />;
}, {
  location: "src/ref-member-passthrough.jsx:6:30",
  signature: "59b78901"
});
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
