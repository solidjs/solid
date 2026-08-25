import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><span>static</span><!><!>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><header><span>static</span><!><!>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><!><span>static`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><span>static`);
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.nextSibling,
  _el$4 = _el$3.nextSibling;
_$insert(_el$, a, _el$3);
_$insert(_el$, b, _el$4);
// Per-slot `<!>` insertion markers × omitLastClosingTag: an element followed
// by multiple dynamic slots must keep its closing tag, or the trailing
// placeholders parse as its children and corrupt the template walk.
const trailingSlotsAfterElement = _el$;
var _el$5 = _tmpl$(),
  _el$6 = _el$5.firstChild,
  _el$7 = _el$6.nextSibling,
  _el$8 = _el$7.nextSibling;
_$insert(_el$5, _$createComponent(Comp, {}), _el$7);
_$insert(_el$5, b, _el$8);
const trailingComponentAndSlot = _el$5;
var _el$9 = _tmpl$2(),
  _el$0 = _el$9.firstChild,
  _el$1 = _el$0.firstChild,
  _el$10 = _el$1.nextSibling,
  _el$11 = _el$10.nextSibling;
_$insert(_el$0, a, _el$10);
_$insert(_el$0, b, _el$11);
const nestedParent = _el$9;

// Safe omissions that must be preserved:
var _el$12 = _tmpl$3(),
  _el$14 = _el$12.firstChild,
  _el$13 = _el$14.nextSibling;
_$insert(_el$12, a, _el$14);
_$insert(_el$12, b, _el$13);
const slotsBeforeElement = _el$12;
var _el$15 = _tmpl$4(),
  _el$16 = _el$15.firstChild;
_$insert(_el$15, a, null);
const singleTrailingSlot = _el$15;
