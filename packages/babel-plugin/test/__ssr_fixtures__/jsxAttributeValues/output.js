import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
var _tmpl$ = ["<div", ">after</div>"],
  _tmpl$2 = ["<div", "></div>"],
  _tmpl$3 = ["<div", "", "></div>"],
  _tmpl$4 = "<button>go</button>",
  _tmpl$5 = "<div></div>",
  _tmpl$6 = ["<span>", "</span>"],
  _tmpl$7 = ["<div>", "</div>"],
  _tmpl$8 = "<span>static</span>",
  _tmpl$9 = ["<label>", "</label>"],
  _tmpl$0 = "<span>own</span>",
  _tmpl$1 = "<h1>fallback</h1>";
var _v$ = () => _$ssrAttribute("data", _tmpl$8);
const staticValue = _$ssr(_tmpl$, _v$);
var _v$2 = () => {
  var _v$8;
  return _$ssrAttribute("data", ((_v$8 = () => _$escape(state.value)), _$ssr(_tmpl$6, _v$8)));
};
const dynamicValue = _$ssr(_tmpl$, _v$2);
var _v$3 = () => _$ssrAttribute("data", (() => _$escape(state.compute(), true))());
const iifeValue = _$ssr(_tmpl$2, _v$3);
var _g$ = _$ssrGroup(() => {
  var _v$9, _v$0;
  return [
    _$ssrAttribute("first", ((_v$9 = () => _$escape(state.first)), _$ssr(_tmpl$6, _v$9))),
    _$ssrAttribute("second", ((_v$0 = () => _$escape(state.second)), _$ssr(_tmpl$9, _v$0)))
  ];
}, 2);
const multiValues = _$ssr(_tmpl$3, _g$, _g$);
const handlerValue = _$ssr(_tmpl$4);
var _ref$ = el => el.appendChild(_$ssr(_tmpl$0));
const refValue = _$ssr(_tmpl$5);
const spreadValue = _$ssrElement(
  "div",
  _$mergeProps(props, {
    get data() {
      var _v$6 = () => _$escape(state.value);
      return _$ssr(_tmpl$6, _v$6);
    }
  }),
  undefined,
  false
);
var _v$7 = _$escape(
  Comp({
    get fallback() {
      return _$ssr(_tmpl$1);
    }
  })
);
const propValue = _$ssr(_tmpl$7, _v$7);
