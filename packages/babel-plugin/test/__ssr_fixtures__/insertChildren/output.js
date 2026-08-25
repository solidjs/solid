import { mergeProps as _$mergeProps } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
var _tmpl$ = "<div></div>",
  _tmpl$2 = ["<module>", "</module>"],
  _tmpl$3 = "<module>Hello</module>",
  _tmpl$4 = ["<module>Hi ", "</module>"],
  _tmpl$5 = "<div>Test 1</div>",
  _tmpl$6 = ["<div>", "</div>"],
  _tmpl$7 = "<module>hello</module>";
const children = _$ssr(_tmpl$);
const dynamic = {
  children
};
const template = Module({
  children: children
});
var _v$ = _$escape(children);
const template2 = _$ssr(_tmpl$2, _v$);
const template3 = _$ssr(_tmpl$3);
var _v$2 = _$escape(Hello({}));
const template4 = _$ssr(_tmpl$2, _v$2);
var _v$3 = () => _$escape(dynamic.children);
const template5 = _$ssr(_tmpl$2, _v$3);
const template6 = Module({
  get children() {
    return dynamic.children;
  }
});
const template7 = _$ssrElement("module", dynamic, undefined, false);
const template8 = _$ssrElement("module", dynamic, "Hello", false);
const template9 = _$ssrElement("module", dynamic, () => _$escape(dynamic.children), false);
const template10 = Module(
  _$mergeProps(dynamic, {
    children: "Hello"
  })
);
var _v$4 = _$escape(/*@static*/ state.children);
const template11 = _$ssr(_tmpl$2, _v$4);
const template12 = Module({
  children: state.children
});
var _v$5 = _$escape(children);
const template13 = _$ssr(_tmpl$2, _v$5);
const template14 = Module({
  children: children
});
var _v$6 = () => _$escape(dynamic.children);
const template15 = _$ssr(_tmpl$2, _v$6);
const template16 = Module({
  get children() {
    return dynamic.children;
  }
});
var _v$7 = _$escape(children);
const template18 = _$ssr(_tmpl$4, _v$7);
const template19 = Module({
  get children() {
    return ["Hi ", children];
  }
});
var _v$8 = () => _$escape(children());
const template20 = _$ssr(_tmpl$2, _v$8);
const template21 = Module({
  get children() {
    return children();
  }
});
var _v$9 = () => _$escape(state.children());
const template22 = _$ssr(_tmpl$2, _v$9);
const template23 = Module({
  get children() {
    return state.children();
  }
});
const template24 = _$ssrElement("module", dynamic, ["Hi", () => _$escape(dynamic.children)], false);
const tiles = [];
tiles.push(_$ssr(_tmpl$5));
var _v$0 = _$escape(tiles);
const template25 = _$ssr(_tmpl$6, _v$0);
var _v$1 = () => _$escape((expression(), "static"));
const comma = _$ssr(_tmpl$6, _v$1);
var _v$10 = () => _$escape(children()());
const double = _$ssr(_tmpl$6, _v$10);
const hello = "hello";
const staticChildren = _$ssr(_tmpl$7);
const foldedChildren = _$ssr(_tmpl$7);
const childrenBeforeSpread = _$ssrElement(
  "module",
  _$mergeProps(
    {
      get children() {
        return fallback();
      }
    },
    props
  ),
  undefined,
  false
);
const childrenAfterSpread = _$ssrElement(
  "module",
  _$mergeProps(props, {
    get children() {
      return later();
    }
  }),
  undefined,
  false
);
