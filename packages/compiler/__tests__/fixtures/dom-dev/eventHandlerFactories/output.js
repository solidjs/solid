import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
import { untrack as _$untrack } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<input>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<button>`);
var _el$ = _tmpl$();
_$insert(_el$, (() => {
	var _c$ = _$memo(() => {
		return !!show();
	});
	return () => {
		return _c$() ? [
			(() => {
				var _el$2 = _tmpl$2();
				_$addEvent(_el$2, "change", _$untrack(() => makeHandler(), "an event handler"));
				return _el$2;
			})(),
			(() => {
				var _el$3 = _tmpl$3();
				_$addEvent(_el$3, "click", _$untrack(() => makeHandler(), "an event handler"), true);
				return _el$3;
			})(),
			(() => {
				var _el$4 = _tmpl$3();
				_$addEvent(_el$4, "click", handler, true);
				return _el$4;
			})()
		] : show();
	};
})(), undefined, undefined, {
	name: "div.children",
	loc: "eventHandlerFactories.jsx:3:5"
});
const branch = _el$;
_$delegateEvents(["click"]);
