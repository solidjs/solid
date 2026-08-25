import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
var _tmpl$ = "<ul><li _key=\"a\">Apple</li></ul>";
var _tmpl$2 = [
	"<ul><li",
	" class=\"",
	"\">",
	"</li></ul>"
];
// `$key` on an intrinsic element compiles to the `_key` attribute the
// frame morph matches keyed elements by. Static keys inline into the
// template; dynamic keys render as ordinary dynamic attributes. On a
// component, `$key` is slot occurrence identity — a prop the runtime owns —
// so it must pass through unrenamed.
const staticKey = _$ssr(_tmpl$);
var _g$ = _$ssrGroup(() => {
	return [_$ssrAttribute("_key", _$escape(item.id, true)), _$ssrClassName(item.cls)];
}, 2), _v$3 = () => {
	return _$escape(item.text);
};
const dynamicKey = _$ssr(_tmpl$2, _g$, _g$, _v$3);
const componentKey = Row({
	get $key() {
		return item.id;
	},
	get text() {
		return item.text;
	}
});
