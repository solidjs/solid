import { memo as _$memo } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
var _v$, _v$2;
var _tmpl$ = "<div>First</div>",
  _tmpl$2 = "<div>Last</div>",
  _tmpl$3 = ["<div", ">First</div>"],
  _tmpl$4 = ["<div", ">Last</div>"],
  _tmpl$5 = "<div></div>",
  _tmpl$6 = "<span>1</span>",
  _tmpl$7 = "<span>2</span>",
  _tmpl$8 = "<span>3</span>";
const multiStatic = [_$ssr(_tmpl$), _$ssr(_tmpl$2)];
const multiExpression = [_$ssr(_tmpl$), inserted, _$ssr(_tmpl$2), "After"];
const multiDynamic = [
  ((_v$ = () => _$ssrAttribute("id", _$escape(state.first, true))), _$ssr(_tmpl$3, _v$)),
  _$memo(() => _$escape(state.inserted)),
  ((_v$2 = () => _$ssrAttribute("id", _$escape(state.last, true))), _$ssr(_tmpl$4, _v$2)),
  "After"
];
const singleExpression = inserted;
const singleDynamic = _$memo(() => _$escape(inserted()));
const firstStatic = [inserted, _$ssr(_tmpl$5)];
const firstDynamic = [_$memo(() => _$escape(inserted())), _$ssr(_tmpl$5)];
const firstComponent = [Component({}), _$ssr(_tmpl$5)];
const lastStatic = [_$ssr(_tmpl$5), inserted];
const lastDynamic = [_$ssr(_tmpl$5), _$memo(() => _$escape(inserted()))];
const lastComponent = [_$ssr(_tmpl$5), Component({})];
const spaces = [_$ssr(_tmpl$6), " ", _$ssr(_tmpl$7), " ", _$ssr(_tmpl$8)];
const multiLineTrailing = [_$ssr(_tmpl$6), _$ssr(_tmpl$7), _$ssr(_tmpl$8)];
