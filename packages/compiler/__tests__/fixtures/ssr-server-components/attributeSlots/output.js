import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { ssrElementAttribute as _$ssrElementAttribute } from "r-server";
import { ssrClaim as _$ssrClaim } from "r-server";
import { sharedConfig as _$sharedConfig } from "r-server";
var _tmpl$ = [
	"<div><button class=\"copy\"",
	">Copy</button><input",
	"><span",
	">warns at render when the gate is open</span><a href=\"/x\"",
	">multiple refs merge to an array</a></div>"
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
var _sk$ = (k) => k === "class";
var _v$ = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({
	click: props.onCopy,
	ref: props.btn
}) : "", _v$2 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({
	input: props.onType,
	keydown: props.onKey
}) : "", _v$3 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ click: localHandler }) : "", _v$4 = _$sharedConfig.context && _$sharedConfig.context.claims ? _$ssrClaim({ ref: [first, second] }) : "";
// Attribute slots (principles §9.2.3). Ref/event positions on server intrinsics
// compile to one guarded whole-attribute claim hole per element, gated on
// the render context's claims flag so plain SSR never evaluates the
// expressions.
const template = _$ssr(_tmpl$, _v$, _v$2, _v$3, _v$4);
// A spread element's named `ref`/`on*` compile to the same claim map a
// template element's do — duplicate refs merged, a tuple kept whole, a
// duplicate handler last-wins — keyed by the index of the source each
// attribute sits before, handed to `ssrElement` as a thunk it reads only
// inside a server component's render, wherever the attributes sit relative
// to the spreads (before, between, after): the runtime settles a handler
// position in source order, as the client's spread does. Plain SSR
// drops them; the tail after the last spread still bakes its statics; the
// spread's own handler keys are the runtime's to bind.
const spread = _$ssrElement("button", rest, [
	_$ssrElement("span", [more, last], undefined, false, undefined, undefined, () => ({
		0: { input: row.type },
		1: { keydown: [row.key, 1] }
	})),
	_$ssrElement("i", last, undefined, false, undefined, undefined, () => ({
		0: { ref: [[row.a, row.b], row.c] },
		1: { click: localHandler }
	})),
	_$ssrElement("em", [
		rest,
		{ title: "t" },
		last
	], undefined, false, undefined, undefined, () => ({ 2: { click: row.third } })),
	_$ssrElement("u", rest, undefined, false, undefined, undefined, () => ({ 1: { ref: row.el } }))
], false, _sk$, " class=\"static\"", () => ({ 1: {
	click: row.go,
	ref: row.el
} }));
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
