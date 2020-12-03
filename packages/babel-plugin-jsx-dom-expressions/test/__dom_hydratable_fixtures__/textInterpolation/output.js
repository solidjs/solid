import { template as _$template } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";

const _tmpl$ = _$template(`<span>Hello </span>`, 2),
  _tmpl$2 = _$template(`<span> John</span>`, 2),
  _tmpl$3 = _$template(`<span>Hello John</span>`, 2),
  _tmpl$4 = _$template(`<span>Hello <!--#--><!--/--></span>`, 4),
  _tmpl$5 = _$template(`<span><!--#--><!--/--> John</span>`, 4),
  _tmpl$6 = _$template(`<span><!--#--><!--/--> <!--#--><!--/--></span>`, 6),
  _tmpl$7 = _$template(`<span> <!--#--><!--/--> <!--#--><!--/--> </span>`, 6),
  _tmpl$8 = _$template(`<span>Hello</span>`, 2),
  _tmpl$9 = _$template(`<span>&nbsp;&lt;Hi&gt;&nbsp;</span>`, 2);

const trailing = _$getNextElement(_tmpl$);

const leading = _$getNextElement(_tmpl$2);
/* prettier-ignore */

const extraSpaces = _$getNextElement(_tmpl$3);

const trailingExpr = (() => {
  const _el$4 = _$getNextElement(_tmpl$4),
    _el$5 = _el$4.firstChild,
    _el$6 = _el$5.nextSibling,
    [_el$7, _co$] = _$getNextMarker(_el$6.nextSibling);

  _$insert(_el$4, name, _el$7, _co$);

  return _el$4;
})();

const leadingExpr = (() => {
  const _el$8 = _$getNextElement(_tmpl$5),
    _el$10 = _el$8.firstChild,
    [_el$11, _co$2] = _$getNextMarker(_el$10.nextSibling),
    _el$9 = _el$11.nextSibling;

  _$insert(_el$8, greeting, _el$11, _co$2);

  return _el$8;
})();
/* prettier-ignore */

const multiExpr = (() => {
  const _el$12 = _$getNextElement(_tmpl$6),
        _el$14 = _el$12.firstChild,
        [_el$15, _co$3] = _$getNextMarker(_el$14.nextSibling),
        _el$13 = _el$15.nextSibling,
        _el$16 = _el$13.nextSibling,
        [_el$17, _co$4] = _$getNextMarker(_el$16.nextSibling);

  _$insert(_el$12, greeting, _el$15, _co$3);

  _$insert(_el$12, name, _el$17, _co$4);

  return _el$12;
})();
/* prettier-ignore */

const multiExprSpaced = (() => {
  const _el$18 = _$getNextElement(_tmpl$7),
        _el$19 = _el$18.firstChild,
        _el$22 = _el$19.nextSibling,
        [_el$23, _co$5] = _$getNextMarker(_el$22.nextSibling),
        _el$20 = _el$23.nextSibling,
        _el$24 = _el$20.nextSibling,
        [_el$25, _co$6] = _$getNextMarker(_el$24.nextSibling),
        _el$21 = _el$25.nextSibling;

  _$insert(_el$18, greeting, _el$23, _co$5);

  _$insert(_el$18, name, _el$25, _co$6);

  return _el$18;
})();
/* prettier-ignore */

const multiLine = _$getNextElement(_tmpl$8);
/* prettier-ignore */

const multiLineTrailingSpace = _$getNextElement(_tmpl$3);
/* prettier-ignore */

const escape = _$getNextElement(_tmpl$9);
