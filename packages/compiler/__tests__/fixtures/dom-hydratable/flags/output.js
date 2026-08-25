import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _el$ = _$getNextElement();
var _el$2 = _el$.firstChild;
var _el$3 = _el$2.nextSibling;
var [_el$4, _el$5] = _$getNextMarker(_el$3.nextSibling);
var _el$6 = _el$4.nextSibling;
var [_el$7, _el$8] = _$getNextMarker(_el$6.nextSibling);
var _el$9 = _el$7.nextSibling;
_$insert(_el$, _$createComponent(Component, {}), _el$4, _el$5);
_$insert(_el$, () => {
	return state.interpolation;
}, _el$7, _el$8);
const template = _el$;
const template2 = _$createComponent(Component, { get children() {
	return _$getNextElement();
} });
const template3 = _$createComponent(Component, { get children() {
	return [_$getNextElement(), _$getNextElement()];
} });
const template4 = _$getNextElement();
