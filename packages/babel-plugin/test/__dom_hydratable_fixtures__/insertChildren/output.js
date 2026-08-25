import { template as _$template } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { runHydrationEvents as _$runHydrationEvents } from "r-dom";
import { spread as _$spread } from "r-dom";
import { scope as _$scope } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<module>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<module>Hello`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<module>Hi <!$><!/>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<module>Hi<!$><!/>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div>Test 1`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<module>hello`);
const children = _$getNextElement(_tmpl$);
const dynamic = {
  children
};
const template = _$createComponent(Module, {
  children: children
});
var _el$2 = _$getNextElement(_tmpl$2);
_$insert(_el$2, children);
const template2 = _el$2;
const template3 = _$getNextElement(_tmpl$3);
var _el$4 = _$getNextElement(_tmpl$2);
_$insert(_el$4, _$createComponent(Hello, {}));
const template4 = _el$4;
var _el$5 = _$getNextElement(_tmpl$2);
_$insert(
  _el$5,
  _$scope(() => dynamic.children)
);
const template5 = _el$5;
const template6 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});
var _el$6 = _$getNextElement(_tmpl$2);
_$spread(_el$6, dynamic, false);
_$runHydrationEvents();
const template7 = _el$6;
var _el$7 = _$getNextElement(_tmpl$3);
_$spread(_el$7, dynamic, true);
_$runHydrationEvents();
const template8 = _el$7;
var _el$8 = _$getNextElement(_tmpl$2);
_$spread(_el$8, dynamic, true);
_$insert(
  _el$8,
  _$scope(() => dynamic.children)
);
_$runHydrationEvents();
const template9 = _el$8;
const template10 = _$createComponent(
  Module,
  _$mergeProps(dynamic, {
    children: "Hello"
  })
);
var _el$9 = _$getNextElement(_tmpl$2);
_$insert(_el$9, /*@static*/ state.children);
const template11 = _el$9;
const template12 = _$createComponent(Module, {
  children: state.children
});
var _el$0 = _$getNextElement(_tmpl$2);
_$insert(_el$0, children);
const template13 = _el$0;
const template14 = _$createComponent(Module, {
  children: children
});
var _el$1 = _$getNextElement(_tmpl$2);
_$insert(
  _el$1,
  _$scope(() => dynamic.children)
);
const template15 = _el$1;
const template16 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});
var _el$10 = _$getNextElement(_tmpl$4),
  _el$11 = _el$10.firstChild,
  [_el$12, _co$] = _$getNextMarker(_el$11.nextSibling);
_$insert(_el$10, children, _el$12, _co$);
const template18 = _el$10;
const template19 = _$createComponent(Module, {
  get children() {
    return ["Hi ", children];
  }
});
var _el$13 = _$getNextElement(_tmpl$2);
_$insert(
  _el$13,
  _$scope(() => children())
);
const template20 = _el$13;
const template21 = _$createComponent(Module, {
  get children() {
    return children();
  }
});
var _el$14 = _$getNextElement(_tmpl$2);
_$insert(
  _el$14,
  _$scope(() => state.children())
);
const template22 = _el$14;
const template23 = _$createComponent(Module, {
  get children() {
    return state.children();
  }
});
var _el$15 = _$getNextElement(_tmpl$5),
  _el$16 = _el$15.firstChild,
  _el$17 = _el$16.nextSibling,
  [_el$18, _co$2] = _$getNextMarker(_el$17.nextSibling);
_$spread(_el$15, dynamic, true);
_$insert(
  _el$15,
  _$scope(() => dynamic.children),
  _el$18,
  _co$2
);
_$runHydrationEvents();
const template24 = _el$15;
const tiles = [];
tiles.push(_$getNextElement(_tmpl$6));
var _el$20 = _$getNextElement(_tmpl$);
_$insert(_el$20, tiles);
const template25 = _el$20;
var _el$21 = _$getNextElement(_tmpl$);
_$insert(_el$21, () => (expression(), "static"));
const comma = _el$21;
var _el$22 = _$getNextElement(_tmpl$);
_$insert(
  _el$22,
  _$scope(() => children()())
);
const double = _el$22;
const hello = "hello";
const staticChildren = _$getNextElement(_tmpl$7);
const foldedChildren = _$getNextElement(_tmpl$7);
var _el$25 = _$getNextElement(_tmpl$2);
_$spread(
  _el$25,
  _$mergeProps(
    {
      get children() {
        return fallback();
      }
    },
    props
  ),
  false
);
_$runHydrationEvents();
const childrenBeforeSpread = _el$25;
var _el$26 = _$getNextElement(_tmpl$2);
_$spread(
  _el$26,
  _$mergeProps(props, {
    get children() {
      return later();
    }
  }),
  false
);
_$runHydrationEvents();
const childrenAfterSpread = _el$26;
