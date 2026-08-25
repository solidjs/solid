import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _tmpl$ = ["<div", "", ">after</div>"],
  _tmpl$2 = ["<div", "", "></div>"],
  _tmpl$3 = ["<div", "", "", "></div>"],
  _tmpl$4 = ["<button", ">go</button>"],
  _tmpl$5 = ["<div", "></div>"],
  _tmpl$6 = ["<span", ">", "</span>"],
  _tmpl$7 = ["<div", ">", "</div>"],
  _tmpl$8 = ["<span", ">static</span>"],
  _tmpl$9 = ["<label", ">", "</label>"],
  _tmpl$0 = ["<span", ">own</span>"],
  _tmpl$1 = ["<h1", ">fallback</h1>"];
var _v$ = _$ssrHydrationKey(),
  _v$2 = () => {
    var _v$14;
    return _$ssrAttribute("data", ((_v$14 = _$ssrHydrationKey()), _$ssr(_tmpl$8, _v$14)));
  };
const staticValue = _$ssr(_tmpl$, _v$, _v$2);
var _v$3 = _$ssrHydrationKey(),
  _v$4 = () => {
    var _v$15, _v$16;
    return _$ssrAttribute(
      "data",
      ((_v$15 = _$ssrHydrationKey()),
      (_v$16 = () => _$escape(state.value)),
      _$ssr(_tmpl$6, _v$15, _v$16))
    );
  };
const dynamicValue = _$ssr(_tmpl$, _v$3, _v$4);
var _v$5 = _$ssrHydrationKey(),
  _v$6 = () => _$ssrAttribute("data", (() => _$escape(state.compute(), true))());
const iifeValue = _$ssr(_tmpl$2, _v$5, _v$6);
var _v$7 = _$ssrHydrationKey(),
  _g$ = _$ssrGroup(() => {
    var _v$17, _v$18, _v$19, _v$20;
    return [
      _$ssrAttribute(
        "first",
        ((_v$17 = _$ssrHydrationKey()),
        (_v$18 = () => _$escape(state.first)),
        _$ssr(_tmpl$6, _v$17, _v$18))
      ),
      _$ssrAttribute(
        "second",
        ((_v$19 = _$ssrHydrationKey()),
        (_v$20 = () => _$escape(state.second)),
        _$ssr(_tmpl$9, _v$19, _v$20))
      )
    ];
  }, 2);
const multiValues = _$ssr(_tmpl$3, _v$7, _g$, _g$);
var _v$0 = _$ssrHydrationKey();
const handlerValue = _$ssr(_tmpl$4, _v$0);
var _v$1 = _$ssrHydrationKey(),
  _ref$ = el => {
    var _v$21;
    return el.appendChild(((_v$21 = _$ssrHydrationKey()), _$ssr(_tmpl$0, _v$21)));
  };
const refValue = _$ssr(_tmpl$5, _v$1);
const spreadValue = _$ssrElement(
  "div",
  () =>
    _$mergeProps(props, {
      get data() {
        var _v$10 = _$ssrHydrationKey(),
          _v$11 = () => _$escape(state.value);
        return _$ssr(_tmpl$6, _v$10, _v$11);
      }
    }),
  undefined,
  true
);
var _v$12 = _$ssrHydrationKey(),
  _v$13 = _$escape(
    Comp({
      get fallback() {
        var _v$22 = _$ssrHydrationKey();
        return _$ssr(_tmpl$1, _v$22);
      }
    })
  );
const propValue = _$ssr(_tmpl$7, _v$12, _v$13);
