import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
var _tmpl$ = "<ul><li _key=\"a\">Apple</li></ul>";
var _tmpl$2 = [
	"<ul><li",
	"",
	">",
	"</li></ul>"
];
var _tmpl$3 = ["<ul>", "</ul>"];
// `$key` on an intrinsic element compiles to the `_key` attribute the
// frame morph matches keyed elements by. Static keys inline into the
// template; dynamic keys render as ordinary dynamic attributes. On a
// component, `$key` is slot occurrence identity — a prop the runtime owns —
// so it must pass through unrenamed.
const staticKey = _$ssr(_tmpl$);
var _g$ = _$ssrGroup(() => {
	return [_$ssrAttribute("_key", _$escape(item.id, true)), ((_v$2) => _v$2 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$2)))(item.cls)];
}, 2), _v$4 = () => {
	return _$escape(item.text);
};
const dynamicKey = _$ssr(_tmpl$2, _g$, _g$, _v$4);
const componentKey = Row({
	get $key() {
		return item.id;
	},
	get text() {
		return item.text;
	}
});
var _v$5 = _$ssrElement("li", [{
	get _key() {
		return item.id;
	},
	class: "todo"
}, () => {
	return item.attrs;
}], () => {
	return _$escape(item.text);
}, false);
// On a spread element the same rule applies to the spread path: the key
// joins the element's sources (renamed for SSR, dropped for DOM) rather than
// the template.
const spreadKey = _$ssr(_tmpl$3, _v$5);
