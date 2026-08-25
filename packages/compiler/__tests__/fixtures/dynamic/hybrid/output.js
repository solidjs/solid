import { spread as _$spread2 } from "r-custom";
import { insert as _$insert2 } from "r-custom";
import { insertNode as _$insertNode2 } from "r-custom";
import { setProp as _$setProp2 } from "r-custom";
import { createElement as _$createElement2 } from "r-custom";
import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { spread as _$spread } from "r-dom";
import { ref as _$ref } from "r-dom";
import { effect as _$effect } from "r-custom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>Hello `);
var _tmpl$2 = /* @__PURE__ */ _$template(`<button>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div><div>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div><button>`);
import { Show } from "somewhere";
const Child = (props) => {
	const [s, set] = createSignal();
	return [(() => {
		var _el$ = _tmpl$();
		var _el$2 = _el$.firstChild;
		var _ref$ = props.ref;
		typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
			return _ref$;
		}, _el$) : props.ref = _el$;
		_$insert(_el$, () => {
			return props.name;
		}, null);
		_$effect(() => (() => {
			var _el$8 = _tmpl$4();
			_$effect(() => s() ? "red" : "green", (_v$) => {
				_$setAttribute(_el$8, "backgroundColor", _v$);
			});
			return _el$8;
		})(), (_v$) => {
			_$setAttribute(_el$, "element", _v$);
		});
		return _el$;
	})(), (() => {
		var _el$3 = _tmpl$3();
		var _el$4 = _el$3.firstChild;
		_$ref(() => {
			return set;
		}, _el$4);
		_$insert(_el$4, () => {
			return props.children;
		});
		_$insert(_el$3, _$createComponent(Canvas, { get children() {
			return [
				(() => {
					var _el$9 = _$createElement2("mesh", {
						scale: 2,
						position: [
							0,
							0,
							0
						],
						geometry: _$createElement2("boxBufferGeometry", { args: [
							0,
							1,
							2
						] })
					});
					_$effect(() => (() => {
						var _el$13 = _$createElement2("basicMaterial", { alpha: 0 });
						_$effect(() => s() ? "red" : "green", (_v$, _$p) => {
							_$setProp2(_el$13, "color", _v$, _$p);
						});
						return _el$13;
					})(), (_v$, _$p) => {
						_$setProp2(_el$9, "material", _v$, _$p);
					});
					return _el$9;
				})(),
				_$createElement2("pointLight"),
				_$createComponent(HTML, { get children() {
					return [(() => {
						var _el$5 = _tmpl$();
						var _el$6 = _el$5.firstChild;
						var _ref$2 = props.ref;
						typeof _ref$2 === "function" || Array.isArray(_ref$2) ? _$ref(() => {
							return _ref$2;
						}, _el$5) : props.ref = _el$5;
						_$insert(_el$5, () => {
							return props.name;
						}, null);
						_$effect(() => (() => {
							var _el$12 = _tmpl$4();
							_$effect(() => s() ? "red" : "green", (_v$) => {
								_$setAttribute(_el$12, "backgroundColor", _v$);
							});
							return _el$12;
						})(), (_v$) => {
							_$setAttribute(_el$5, "element", _v$);
						});
						return _el$5;
					})(), _tmpl$2()];
				} })
			];
		} }), null);
		return _el$3;
	})()];
};
const Component = (props) => {
	var _el$14 = _tmpl$4();
	_$insert(_el$14, (() => {
		var _c$ = _$memo(() => {
			return !!props.three;
		});
		return () => {
			return _c$() ? (() => {
				var _el$15 = _$createElement2("mesh", {
					scale: 2,
					position: [
						0,
						0,
						0
					],
					geometry: _$createElement2("boxBufferGeometry", { args: [
						0,
						1,
						2
					] })
				});
				var _el$17 = _$createElement2("pointLight");
				_$insertNode2(_el$15, _el$17);
				_$effect(() => (() => {
					var _el$19 = _$createElement2("basicMaterial", { alpha: 0 });
					_$effect(() => s() ? "red" : "green", (_v$, _$p) => {
						_$setProp2(_el$19, "color", _v$, _$p);
					});
					return _el$19;
				})(), (_v$, _$p) => {
					_$setProp2(_el$15, "material", _v$, _$p);
				});
				return _el$15;
			})() : _tmpl$5();
		};
	})());
	return _el$14;
};
const Mesh = (props) => {
	var _el$20 = _$createElement2("group");
	_$spread2(_el$20, props, true);
	_$insert2(_el$20, [(() => {
		var _el$21 = _$createElement2("group");
		_$insert2(_el$21, a ? _$createElement2("mesh") : _$createElement2("instancedMesh"));
		return _el$21;
	})(), _$createComponent(HTML, { get children() {
		var _el$24 = _tmpl$4();
		_$spread(_el$24, props, true);
		_$insert(_el$24, b ? _tmpl$4() : _tmpl$2());
		return _el$24;
	} })]);
	return _el$20;
};
