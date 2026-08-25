import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _el$ = _$getNextElement(),
  _el$2 = _el$.firstChild,
  _el$4 = _el$2.nextSibling,
  [_el$5, _co$] = _$getNextMarker(_el$4.nextSibling),
  _el$6 = _el$5.nextSibling,
  [_el$7, _co$2] = _$getNextMarker(_el$6.nextSibling),
  _el$3 = _el$7.nextSibling;
_$insert(_el$, _$createComponent(Component, {}), _el$5, _co$);
_$insert(_el$, () => state.interpolation, _el$7, _co$2);
const template = _el$;
const template2 = _$createComponent(Component, {
  get children() {
    return _$getNextElement();
  }
});
const template3 = _$createComponent(Component, {
  get children() {
    return [_$getNextElement(), _$getNextElement()];
  }
});
const template4 = _$getNextElement();
