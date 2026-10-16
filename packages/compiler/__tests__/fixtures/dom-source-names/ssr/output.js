import { escape as _$escape } from "r-dom";
import { ssr as _$ssr } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
import { Show as _$Show } from "r-dom";
var _v$;
var _tmpl$ = ["<span>", "</span>"];
var _tmpl$2 = [
	"<div>",
	"",
	"",
	"",
	"",
	"",
	"",
	"</div>"
];
import { Child, Ui, Row } from "./components";
const Component = () => _$createComponent(Child, { name: "John" }, "Child", "ssr.jsx:3:25");
const template = (() => {
	var _v$2 = _$escape(_$createComponent(Child, _$mergeProps({ name: "Jane" }, props, { get children() {
		return _v$ = () => {
			return _$escape(name());
		}, _$ssr(_tmpl$, _v$);
	} }), "Child", "ssr.jsx:7:5")), _v$3 = _$escape(_$createComponent(Ui.Button, { variant: "primary" }, "Ui.Button", "ssr.jsx:10:5")), _v$4 = _$escape(_$createComponent(Ui.Layout.Grid, {
		cols: 2,
		children: "text"
	}, "Ui.Layout.Grid", "ssr.jsx:11:5")), _v$5 = _$escape(_$createComponent(_$For, {
		get each() {
			return list();
		},
		children: (item) => _$createComponent(Row, { item }, "Row", "ssr.jsx:12:33")
	}, "For", "ssr.jsx:12:5")), _v$6 = _$escape(_$createComponent(_$Show, {
		get when() {
			return visible();
		},
		get children() {
			return _$createComponent(Child, {}, "Child", "ssr.jsx:14:7");
		}
	}, "Show", "ssr.jsx:13:5")), _v$7 = _$escape(_$createComponent(_self$.Row, {}, "this.Row", "ssr.jsx:16:5")), _v$8 = _$escape(_$createComponent(Comp, { children: () => _$createComponent(Child, {}, "Child", "ssr.jsx:17:18") }, "Comp", "ssr.jsx:17:5"));
	const _self$ = this;
	return _$ssr(_tmpl$2, _v$2, _v$3, _v$4, _v$5, _v$6, _v$7, _v$8);
})();
class Container {
	render() {
		return _$createComponent(this.Row, {}, "this.Row", "ssr.jsx:23:12");
	}
}
