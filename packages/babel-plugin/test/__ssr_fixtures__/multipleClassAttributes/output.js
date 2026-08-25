import { ssrClassName as _$ssrClassName } from "r-server";
import { ssr as _$ssr } from "r-server";
var _tmpl$ = '<div class="b">static static</div>',
  _tmpl$2 = ['<div class="', '">static + dynamic</div>'],
  _tmpl$3 = '<div class="on">two dynamic</div>',
  _tmpl$4 = ['<div class="', '">string + object</div>'],
  _tmpl$5 = '<div class="c">three statics</div>';
// Duplicate attributes on the same element resolve to the last value
// (matching JSX spread semantics: later attributes override earlier ones).
// This test keeps the `class=` case specifically since it used to be a
// special compiler path.
const dynamicClass = () => "dyn";
const flag = true;
const t1 = _$ssr(_tmpl$);
var _v$ = () => _$ssrClassName(dynamicClass());
const t2 = _$ssr(_tmpl$2, _v$);
const t3 = _$ssr(_tmpl$3);
const t4 = _$ssr(_tmpl$4, "active ");
const t5 = _$ssr(_tmpl$5);
