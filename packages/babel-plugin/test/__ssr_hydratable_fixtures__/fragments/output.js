import { memo as _$memo } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _v$,
  _v$2,
  _v$3,
  _v$4,
  _v$5,
  _v$6,
  _v$7,
  _v$8,
  _v$9,
  _v$0,
  _v$1,
  _v$10,
  _v$11,
  _v$12,
  _v$13,
  _v$14,
  _v$15,
  _v$16,
  _v$17,
  _v$18;
var _tmpl$ = ["<div", ">First</div>"],
  _tmpl$2 = ["<div", ">Last</div>"],
  _tmpl$3 = ["<div", "", ">First</div>"],
  _tmpl$4 = ["<div", "", ">Last</div>"],
  _tmpl$5 = ["<div", "></div>"],
  _tmpl$6 = ["<span", ">1</span>"],
  _tmpl$7 = ["<span", ">2</span>"],
  _tmpl$8 = ["<span", ">3</span>"];
const multiStatic = [
  ((_v$ = _$ssrHydrationKey()), _$ssr(_tmpl$, _v$)),
  ((_v$2 = _$ssrHydrationKey()), _$ssr(_tmpl$2, _v$2))
];
const multiExpression = [
  ((_v$3 = _$ssrHydrationKey()), _$ssr(_tmpl$, _v$3)),
  inserted,
  ((_v$4 = _$ssrHydrationKey()), _$ssr(_tmpl$2, _v$4)),
  "After"
];
const multiDynamic = [
  ((_v$5 = _$ssrHydrationKey()),
  (_v$6 = () => _$ssrAttribute("id", _$escape(state.first, true))),
  _$ssr(_tmpl$3, _v$5, _v$6)),
  _$memo(() => _$escape(state.inserted)),
  ((_v$7 = _$ssrHydrationKey()),
  (_v$8 = () => _$ssrAttribute("id", _$escape(state.last, true))),
  _$ssr(_tmpl$4, _v$7, _v$8)),
  "After"
];
const singleExpression = inserted;
const singleDynamic = _$memo(() => _$escape(inserted()));
const firstStatic = [inserted, ((_v$9 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$9))];
const firstDynamic = [
  _$memo(() => _$escape(inserted())),
  ((_v$0 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$0))
];
const firstComponent = [Component({}), ((_v$1 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$1))];
const lastStatic = [((_v$10 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$10)), inserted];
const lastDynamic = [
  ((_v$11 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$11)),
  _$memo(() => _$escape(inserted()))
];
const lastComponent = [((_v$12 = _$ssrHydrationKey()), _$ssr(_tmpl$5, _v$12)), Component({})];
const spaces = [
  ((_v$13 = _$ssrHydrationKey()), _$ssr(_tmpl$6, _v$13)),
  " ",
  ((_v$14 = _$ssrHydrationKey()), _$ssr(_tmpl$7, _v$14)),
  " ",
  ((_v$15 = _$ssrHydrationKey()), _$ssr(_tmpl$8, _v$15))
];
const multiLineTrailing = [
  ((_v$16 = _$ssrHydrationKey()), _$ssr(_tmpl$6, _v$16)),
  ((_v$17 = _$ssrHydrationKey()), _$ssr(_tmpl$7, _v$17)),
  ((_v$18 = _$ssrHydrationKey()), _$ssr(_tmpl$8, _v$18))
];
