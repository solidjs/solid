import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { effect as _$effect } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { runHydrationEvents as _$runHydrationEvents } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
    `<div id=main><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated`
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<div><button onclick="console.log('static')">Static Attribute</button><button>Identifier Attribute</button><button>Dynamic Attribute</button><button>Function Attribute</button><button>Spread Attribute`
  );
function hoistedCustomEvent1() {
  console.log("hoisted");
}
const hoistedcustomevent2 = () => console.log("hoisted");
var _el$ = _$getNextElement(_tmpl$),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.nextSibling,
  _el$4 = _el$3.nextSibling,
  _el$5 = _el$4.nextSibling;
_el$2.addEventListener("change", () => console.log("bound"));
_el$3.addEventListener("change", e => (id => console.log("bound", id))(id, e));
_el$4._$$click = () => console.log("delegated");
_el$5._$$click = id => console.log("delegated", id);
_el$5._$$clickData = rowId;
_$runHydrationEvents();
const template = _el$;
var _el$6 = _$getNextElement(_tmpl$2),
  _el$7 = _el$6.firstChild,
  _el$8 = _el$7.nextSibling,
  _el$9 = _el$8.nextSibling,
  _el$0 = _el$9.nextSibling,
  _el$1 = _el$0.nextSibling;
_$setAttribute(_el$8, "onclick", code);
_$setAttribute(_el$0, "onclick", () => console.log("not a handler"));
_$spread(
  _el$1,
  [
    rest,
    {
      onclick: code
    }
  ],
  true
);
_$effect(
  () => state.code,
  _v$ => {
    _$setAttribute(_el$9, "onmouseover", _v$);
  }
);
_$runHydrationEvents();
const lowercaseAttributes = _el$6;
_$delegateEvents(["click"]);
