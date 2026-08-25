import { memo as _$memo } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
var _v$, _v$2, _v$3, _v$4, _v$5, _v$6, _v$7, _v$8, _v$9, _v$10, _v$11, _v$12, _v$13, _v$14, _v$15, _v$16, _v$17, _v$18, _v$19, _v$20;
var _tmpl$ = ["<div", ">First</div>"];
var _tmpl$2 = ["<div", ">Last</div>"];
var _tmpl$3 = [
	"<div",
	"",
	">First</div>"
];
var _tmpl$4 = [
	"<div",
	"",
	">Last</div>"
];
var _tmpl$5 = ["<div", "></div>"];
var _tmpl$6 = ["<span", ">1</span>"];
var _tmpl$7 = ["<span", ">2</span>"];
var _tmpl$8 = ["<span", ">3</span>"];
const multiStatic = [(_v$ = _$ssrHydrationKey(), _$ssr(_tmpl$, _v$)), (_v$2 = _$ssrHydrationKey(), _$ssr(_tmpl$2, _v$2))];
const multiExpression = [
	(_v$3 = _$ssrHydrationKey(), _$ssr(_tmpl$, _v$3)),
	inserted,
	(_v$4 = _$ssrHydrationKey(), _$ssr(_tmpl$2, _v$4)),
	"After"
];
const multiDynamic = [
	(_v$5 = _$ssrHydrationKey(), _v$6 = () => {
		return _$ssrAttribute("id", _$escape(state.first, true));
	}, _$ssr(_tmpl$3, _v$5, _v$6)),
	_$memo(() => {
		return _$escape(state.inserted);
	}),
	(_v$7 = _$ssrHydrationKey(), _v$8 = () => {
		return _$ssrAttribute("id", _$escape(state.last, true));
	}, _$ssr(_tmpl$4, _v$7, _v$8)),
	"After"
];
const singleExpression = inserted;
const singleDynamic = _$memo(() => {
	return _$escape(inserted());
});
const firstStatic = [inserted, (_v$9 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$9))];
const firstDynamic = [_$memo(() => {
	return _$escape(inserted());
}), (_v$10 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$10))];
const firstComponent = [Component({}), (_v$11 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$11))];
const lastStatic = [(_v$12 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$12)), inserted];
const lastDynamic = [(_v$13 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$13)), _$memo(() => {
	return _$escape(inserted());
})];
const lastComponent = [(_v$14 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$14)), Component({})];
const spaces = [
	(_v$15 = _$ssrHydrationKey(), _$ssr(_tmpl$6, _v$15)),
	" ",
	(_v$16 = _$ssrHydrationKey(), _$ssr(_tmpl$7, _v$16)),
	" ",
	(_v$17 = _$ssrHydrationKey(), _$ssr(_tmpl$8, _v$17))
];
const multiLineTrailing = [
	(_v$18 = _$ssrHydrationKey(), _$ssr(_tmpl$6, _v$18)),
	(_v$19 = _$ssrHydrationKey(), _$ssr(_tmpl$7, _v$19)),
	(_v$20 = _$ssrHydrationKey(), _$ssr(_tmpl$8, _v$20))
];
