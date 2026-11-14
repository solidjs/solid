import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { strictHandler as _$strictHandler } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
    `<div><button></button><button></button><button></button><button>`
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<div><button></button><button></button><button></button><input>`
  ),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><button></button><button></button><input><input>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><video></video><video></video><dialog>`);
// Event handler expressions in dev DOM output (#1742): a handler is bound
// once, where its element is created, so any expression that can read
// reactive state goes through `strictHandler(() => expr)`. The dev runtime
// warns on a reactive read there and still tracks it. Identifiers, inline
// functions and literals cannot read anything and compile as in production.
function handler() {}
const local = () => {};
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.nextSibling,
  _el$4 = _el$3.nextSibling,
  _el$5 = _el$4.nextSibling;
_el$2._$$click = handler;
_el$3._$$click = local;
_el$4._$$click = () => count(c => c + 1);
_$addEvent(_el$5, "click", unknown, true);
const plain = _el$;
var _el$6 = _tmpl$2(),
  _el$7 = _el$6.firstChild,
  _el$8 = _el$7.nextSibling,
  _el$9 = _el$8.nextSibling,
  _el$0 = _el$9.nextSibling;
_$addEvent(
  _el$7,
  "click",
  _$strictHandler(() => props.onClick),
  true
);
_$addEvent(
  _el$8,
  "click",
  _$strictHandler(() => makeHandler(id())),
  true
);
_$addEvent(
  _el$9,
  "click",
  _$strictHandler(() => (selected() ? a : b)),
  true
);
_$addEvent(
  _el$0,
  "input",
  _$strictHandler(() => store.handlers.input),
  true
);
const forwarded = _el$6;
var _el$1 = _tmpl$3(),
  _el$10 = _el$1.firstChild,
  _el$11 = _el$10.nextSibling,
  _el$12 = _el$11.nextSibling,
  _el$13 = _el$12.nextSibling;
_el$10._$$click = _$strictHandler(() => props.select);
_el$10._$$clickData = _$strictHandler(() => row.id);
_el$11._$$click = handler;
_el$11._$$clickData = _$strictHandler(() => id());
_el$12._$$input = _$strictHandler(() => props.update);
_el$13.addEventListener("focus", e => props.focus(row.id, e));
const bound = _el$1;
var _el$14 = _tmpl$4(),
  _el$15 = _el$14.firstChild,
  _el$16 = _el$15.nextSibling,
  _el$17 = _el$16.nextSibling;
_$addEvent(
  _el$15,
  "play",
  _$strictHandler(() => props.onPlay)
);
_el$16.addEventListener("play", () => play());
_$addEvent(
  _el$17,
  "close",
  _$strictHandler(() => ({
    handleEvent: props.onClose,
    once: true
  }))
);
const nonDelegated = _el$14;
_$delegateEvents(["click", "input"]);
