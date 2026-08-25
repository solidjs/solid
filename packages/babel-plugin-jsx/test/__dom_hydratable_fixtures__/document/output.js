import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMatch as _$getNextMatch } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _el$ = _$getNextElement(),
  _el$2 = _$getNextMatch(_el$.firstChild, "head"),
  _el$3 = _el$2.firstChild,
  _el$4 = _el$3.nextSibling,
  _el$5 = _el$4.nextSibling,
  _el$6 = _el$5.nextSibling,
  _el$7 = _el$6.nextSibling,
  [_el$8, _co$] = _$getNextMarker(_el$7.nextSibling),
  _el$9 = _$getNextMatch(_el$2.nextSibling, "body"),
  _el$0 = _el$9.firstChild,
  _el$10 = _el$0.nextSibling,
  [_el$11, _co$2] = _$getNextMarker(_el$10.nextSibling),
  _el$1 = _el$11.nextSibling;
_$insert(_el$2, _$createComponent(Assets, {}), _el$8, _co$);
_$insert(_el$9, _$createComponent(App, {}), _el$11, _co$2);
const template = _el$;
var _el$12 = _$getNextElement(),
  _el$13 = _el$12.firstChild,
  _el$14 = _el$13.nextSibling,
  _el$15 = _el$14.nextSibling,
  _el$16 = _el$15.nextSibling,
  _el$17 = _el$16.nextSibling,
  [_el$18, _co$3] = _$getNextMarker(_el$17.nextSibling);
_$insert(_el$12, _$createComponent(Assets, {}), _el$18, _co$3);
const templateHead = _el$12;
var _el$19 = _$getNextElement(),
  _el$20 = _el$19.firstChild,
  _el$22 = _el$20.nextSibling,
  [_el$23, _co$4] = _$getNextMarker(_el$22.nextSibling),
  _el$21 = _el$23.nextSibling;
_$insert(_el$19, _$createComponent(App, {}), _el$23, _co$4);
const templateBody = _el$19;
var _el$24 = _$getNextElement(),
  _el$25 = _el$24.firstChild,
  [_el$26, _co$5] = _$getNextMarker(_el$25.nextSibling),
  _el$27 = _el$26.nextSibling,
  [_el$28, _co$6] = _$getNextMarker(_el$27.nextSibling);
_$insert(_el$24, _$createComponent(Head, {}), _el$26, _co$5);
_$insert(_el$24, _$createComponent(Body, {}), _el$28, _co$6);
const templateEmptied = _el$24;
