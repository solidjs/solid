import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>First</div><div>Last</div>`, 4);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div>First`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div>Last`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div>`);
const multiStatic = _tmpl$();
const multiExpression = [
	_tmpl$2(),
	inserted,
	_tmpl$3(),
	"After"
];
const multiDynamic = [
	(() => {
		var _el$5 = _tmpl$2();
		_$setAttribute(_el$5, "id", state.first);
		return _el$5;
	})(),
	() => {
		return state.inserted;
	},
	(() => {
		var _el$6 = _tmpl$3();
		_$setAttribute(_el$6, "id", state.last);
		return _el$6;
	})(),
	"After"
];
const singleExpression = inserted;
const singleDynamic = inserted;
const firstStatic = [inserted, _tmpl$4()];
const firstDynamic = [inserted, _tmpl$4()];
const firstComponent = [_$createComponent(Component, {}), _tmpl$4()];
const lastStatic = [_tmpl$4(), inserted];
const lastDynamic = [_tmpl$4(), inserted];
const lastComponent = [_tmpl$4(), _$createComponent(Component, {})];
