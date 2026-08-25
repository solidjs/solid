import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _v$4, _v$5, _v$6, _v$7;
var _tmpl$ = [
	"<div",
	"><h1>Hello</h1><!--$-->",
	"<!--/--><!--$-->",
	"<!--/--><span>More Text</span></div>"
];
var _tmpl$2 = ["<div", "></div>"];
var _tmpl$3 = ["<span", "></span>"];
var _v$ = _$ssrHydrationKey(), _v$2 = _$escape(Component({})), _v$3 = () => {
	return _$escape(state.interpolation);
};
const template = _$ssr(_tmpl$, _v$, _v$2, _v$3);
const template2 = Component({ get children() {
	return _v$4 = _$ssrHydrationKey(), _$ssr(_tmpl$2, _v$4);
} });
const template3 = Component({ get children() {
	return [(_v$5 = _$ssrHydrationKey(), _$ssr(_tmpl$2, _v$5)), (_v$6 = _$ssrHydrationKey(), _$ssr(_tmpl$3, _v$6))];
} });
const template4 = (_v$7 = _$ssrHydrationKey(), _$ssr(_tmpl$2, _v$7));
