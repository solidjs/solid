import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
interface P {
	n?: number;
}
type Alias = string;
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", <T,>(props: P & {
	list: T[];
}): any => {
	const map: Record<string, Alias[]> = {};
	const fn = (x: number): string => String(x);
	const tup: [number, string] = [1, "a"];
	const un: "a" | "b" | null = null;
	const idx: P["n"] = props.n!;
	const q: typeof map = map;
	const ro: readonly string[] = [];
	return <div>{(props.list.length as unknown) as string}</div>;
}, {
	location: "src/typescript.tsx:5:19",
	signature: "86484f70",
	dependencies: () => ({ String })
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
