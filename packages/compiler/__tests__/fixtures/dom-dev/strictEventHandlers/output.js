import { template as _$template } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
import { strictHandler as _$strictHandler } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><button></button><button></button><button></button><button>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div><button></button><button></button><button></button><input>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div><button></button><button></button><input><input>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div><video></video><video></video><dialog>`);
// Event handler expressions in dev DOM output (#1742): a handler is bound
// once, where its element is created, so any expression that can read
// reactive state goes through `strictHandler(() => expr)`. The dev runtime
// warns on a reactive read there and still tracks it. Identifiers, inline
// functions and literals cannot read anything and compile as in production.
function handler() {}
const local = () => {};
var _el$ = _tmpl$();
var _el$2 = _el$.firstChild;
var _el$3 = _el$2.nextSibling;
var _el$4 = _el$3.nextSibling;
var _el$5 = _el$4.nextSibling;
_el$2._$$click = handler;
_el$3._$$click = local;
_el$4._$$click = () => count((c) => c + 1);
_$addEvent(_el$5, "click", unknown, true);
const plain = _el$;
var _el$6 = _tmpl$2();
var _el$7 = _el$6.firstChild;
var _el$8 = _el$7.nextSibling;
var _el$9 = _el$8.nextSibling;
var _el$10 = _el$9.nextSibling;
_$addEvent(_el$7, "click", _$strictHandler(() => props.onClick), true);
_$addEvent(_el$8, "click", _$strictHandler(() => makeHandler(id())), true);
_$addEvent(_el$9, "click", _$strictHandler(() => selected() ? a : b), true);
_$addEvent(_el$10, "input", _$strictHandler(() => store.handlers.input), true);
const forwarded = _el$6;
var _el$11 = _tmpl$3();
var _el$12 = _el$11.firstChild;
var _el$13 = _el$12.nextSibling;
var _el$14 = _el$13.nextSibling;
var _el$15 = _el$14.nextSibling;
_el$12._$$click = _$strictHandler(() => props.select);
_el$12._$$clickData = _$strictHandler(() => row.id);
_el$13._$$click = handler;
_el$13._$$clickData = _$strictHandler(() => id());
_el$14._$$input = _$strictHandler(() => props.update);
_el$15.addEventListener("focus", (e) => {
	return props.focus(row.id, e);
});
const bound = _el$11;
var _el$16 = _tmpl$4();
var _el$17 = _el$16.firstChild;
var _el$18 = _el$17.nextSibling;
var _el$19 = _el$18.nextSibling;
_$addEvent(_el$17, "play", _$strictHandler(() => props.onPlay));
_el$18.addEventListener("play", () => play());
_$addEvent(_el$19, "close", _$strictHandler(() => ({
	handleEvent: props.onClose,
	once: true
})));
const nonDelegated = _el$16;
_$delegateEvents(["click", "input"]);
