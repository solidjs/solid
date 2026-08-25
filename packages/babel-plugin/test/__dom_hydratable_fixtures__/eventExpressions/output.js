import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { runHydrationEvents as _$runHydrationEvents } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
  `<div id=main><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated`
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
_el$4.$$click = () => console.log("delegated");
_el$5.$$click = id => console.log("delegated", id);
_el$5.$$clickData = rowId;
_$runHydrationEvents();
const template = _el$;
_$delegateEvents(["click"]);
