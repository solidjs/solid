import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
var _tmpl$ = '<div id="second">id</div>',
  _tmpl$2 = ["<div", ">title</div>"],
  _tmpl$3 = '<div data-x="fixed">data</div>',
  _tmpl$4 = '<svg><use xlink:href="#b"></use></svg>',
  _tmpl$5 = "<input>";
// Duplicate attributes (not just `class`) resolve to the last value.
const dynamicId = () => "dyn-id";

// Same attribute twice, both static.
const t1 = _$ssr(_tmpl$);

// Static then dynamic — dynamic wins.
var _v$ = () => _$ssrAttribute("title", _$escape(dynamicId(), true));
const t2 = _$ssr(_tmpl$2, _v$);

// Dynamic then static — static wins.
const t3 = _$ssr(_tmpl$3);

// Namespaced (xlink:href) duplicates.
const t4 = _$ssr(_tmpl$4);

// Boolean attribute duplicated with different values.
const t5 = _$ssr(_tmpl$5);
