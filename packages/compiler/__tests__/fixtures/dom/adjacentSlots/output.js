import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><span>static</span><!><!>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div><header><span>static</span><!><!>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div><!><span>static`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div><span>static`);
var _el$ = _tmpl$();
var _el$2 = _el$.firstChild;
var _el$3 = _el$2.nextSibling;
var _el$4 = _el$3.nextSibling;
_$insert(_el$, a, _el$3);
_$insert(_el$, b, _el$4);
// Per-slot `<!>` insertion markers × omitLastClosingTag: an element followed
// by multiple dynamic slots must keep its closing tag, or the trailing
// placeholders parse as its children and corrupt the template walk.
const trailingSlotsAfterElement = _el$;
var _el$5 = _tmpl$();
var _el$6 = _el$5.firstChild;
var _el$7 = _el$6.nextSibling;
var _el$8 = _el$7.nextSibling;
_$insert(_el$5, _$createComponent(Comp, {}), _el$7);
_$insert(_el$5, b, _el$8);
const trailingComponentAndSlot = _el$5;
var _el$9 = _tmpl$2();
var _el$10 = _el$9.firstChild;
var _el$11 = _el$10.firstChild;
var _el$12 = _el$11.nextSibling;
var _el$13 = _el$12.nextSibling;
_$insert(_el$10, a, _el$12);
_$insert(_el$10, b, _el$13);
const nestedParent = _el$9;
var _el$14 = _tmpl$3();
var _el$15 = _el$14.firstChild;
var _el$16 = _el$15.nextSibling;
_$insert(_el$14, a, _el$15);
_$insert(_el$14, b, _el$15.nextSibling);
// Safe omissions that must be preserved:
const slotsBeforeElement = _el$14;
var _el$17 = _tmpl$4();
var _el$18 = _el$17.firstChild;
_$insert(_el$17, a, null);
const singleTrailingSlot = _el$17;
