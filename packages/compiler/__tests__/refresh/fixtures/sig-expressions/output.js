import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => {
	const seq = (0, fn)();
	const pow = (-1) ** 2 ** 3;
	const mix = a ?? (b || c);
	const mix2 = (d && e) ?? f;
	const cond = (a ? b : c) ? d : e ? f : g;
	const un = - -x + + +y - ~!z;
	const num = 5 .toFixed(1) + 255 + .5 + 1e3;
	const call = new Date().getTime() + new a.b.c() + new (getCtor())();
	const opt = a?.b?.() + (a?.b)();
	const tpl = tag`x ${{ k: 1 }.k}y`;
	const arr2 = [
		,
		a,
		,
	];
	const obj2 = {
		m() {
			return 1;
		},
		get g() {
			return 2;
		},
		set s(v) {},
		async am() {},
		*gm() {},
		[k]: v,
		"str key": 1,
		99: x,
		short
	};
	const fns = function() {}() + (async () => q)();
	const upd = i++ + --j;
	const assigns = (v ||= 1, w ??= 2, u **= 3);
	const bin = a instanceof B && "k" in obj;
	const chain2 = (x) => (y) => x + y;
	return seq;
}, {
	location: "src/sig-expressions.jsx:1:19",
	signature: "b4524b53",
	dependencies: () => ({
		fn,
		a,
		b,
		c,
		d,
		e,
		f,
		g,
		x,
		y,
		z,
		Date,
		getCtor,
		tag,
		k,
		v,
		short,
		q,
		i,
		j,
		B,
		obj
	})
});
if (import.meta.hot) {
	import.meta.hot.accept();
	_$$refresh("vite", import.meta.hot, _REGISTRY);
}
