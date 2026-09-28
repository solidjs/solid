import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElementAttribute as _$ssrElementAttribute } from "r-server";
import { ssrClaim as _$ssrClaim } from "r-server";
import { sharedConfig as _$sharedConfig } from "r-server";
var _tmpl$ = [
	"<div><button class=\"copy\"",
	">Copy</button><input",
	"><span",
	">warns at render when the gate is open</span><a href=\"/x\"",
	">multiple refs merge to an array</a><section>capture variants stay dropped</section></div>"
];
var _tmpl$2 = [
	"<li",
	"",
	"",
	">",
	"</li>"
];
var _tmpl$3 = [
	"<li",
	"",
	"><input type=\"checkbox\"",
	"",
	"",
	"><span class=\"static stays\">",
	"</span></li>"
];
var _v$ = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({
	click: props.onCopy,
	ref: props.btn
}) : "", _v$2 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({
	input: props.onType,
	"custom-thing": props.onCustom
}) : "", _v$3 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ click: localHandler }) : "", _v$4 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ ref: [first, second] }) : "";
// Attribute slots (principles §9.2.3). Ref/event positions on server intrinsics
// compile to one guarded whole-attribute claim hole per element, gated on
// the render context's claims flag so plain SSR never evaluates the
// expressions.
const template = _$ssr(_tmpl$, _v$, _v$2, _v$3, _v$4);
var _g$ = _$ssrGroup(() => {
	return [_$ssrElementAttribute("class", status()), _$ssrElementAttribute("style", row.style)];
}, 2), _v$7 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ click: props.onPick }) : "", _v$8 = () => {
	return _$escape(label());
};
// A dynamic `class`/`style` is a whole-attribute element-attribute hole
// rather than a value inside template quotes, so a slot value read at the
// position — whole, or as a name's condition in object form — binds instead
// of stringifying. Object literals stay objects. Static strings stay static.
const dynamicToo = _$ssr(_tmpl$2, _g$, _g$, _v$7, _v$8);
var _g$2 = _$ssrGroup(() => {
	return [_$ssrElementAttribute("class", {
		completed: row.done,
		editing: row.editing
	}), _$ssrElementAttribute("style", { color: row.color })];
}, 2), _v$12 = () => {
	return _$ssrAttribute("hidden", _$escape(row.removed, true));
}, _v$13 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ input: row.toggle }) : "", _v$14 = () => {
	return _$escape(label());
}, _v$11 = () => {
	return _$ssrAttribute("checked", _$escape(row.done, true));
};
const objects = _$ssr(_tmpl$3, _g$2, _g$2, _v$11, _v$12, _v$13, _v$14);
