import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
var _v$7;
var _tmpl$ = [
	"<my-element",
	"",
	"",
	"",
	"></my-element>"
];
var _tmpl$2 = ["<my-element", "><header slot=\"head\">Title</header></my-element>"];
var _tmpl$3 = ["<slot", " name=\"head\"></slot>"];
var _tmpl$4 = ["<a", " is=\"my-element\"></a>"];
var _v$ = _$ssrHydrationKey();
const template = _$ssr(_tmpl$, _v$, _$ssrAttribute("some-attr", _$escape(name, true)), _$ssrAttribute("notProp", _$escape(data, true)), _$ssrAttribute("my-attr", _$escape(data, true)));
var _v$2 = _$ssrHydrationKey(), _g$ = _$ssrGroup(() => {
	return [
		_$ssrAttribute("some-attr", _$escape(state.name, true)),
		_$ssrAttribute("notProp", _$escape(state.data, true)),
		_$ssrAttribute("my-attr", _$escape(state.data, true))
	];
}, 3);
const template2 = _$ssr(_tmpl$, _v$2, _g$, _g$, _g$);
var _v$6 = _$ssrHydrationKey();
const template3 = _$ssr(_tmpl$2, _v$6);
const template4 = (_v$7 = _$ssrHydrationKey(), _$ssr(_tmpl$3, _v$7));
var _v$8 = _$ssrHydrationKey();
const template5 = _$ssr(_tmpl$4, _v$8);
