import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
  `<div id=main><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated`
);
function hoisted1() {
  console.log("hoisted");
}
const hoisted2 = () => console.log("hoisted delegated");
function hoistedCustomEvent1() {
  console.log("hoisted");
}
const hoistedCustomEvent2 = () => console.log("hoisted");
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.nextSibling,
  _el$4 = _el$3.nextSibling,
  _el$5 = _el$4.nextSibling,
  _el$6 = _el$5.nextSibling,
  _el$7 = _el$6.nextSibling,
  _el$8 = _el$7.nextSibling,
  _el$9 = _el$8.nextSibling,
  _el$0 = _el$9.nextSibling,
  _el$1 = _el$0.nextSibling;
_el$2.addEventListener("change", () => console.log("bound"));
_el$3.addEventListener("change", e => (id => console.log("bound", id))(id, e));
_$addEvent(_el$4, "change", handler);
_el$5.addEventListener("change", handler);
_el$6.addEventListener("change", hoisted1);
_el$7.$$click = () => console.log("delegated");
_el$8.$$click = id => console.log("delegated", id);
_el$8.$$clickData = rowId;
_$addEvent(_el$9, "click", handler, true);
_el$0.$$click = handler;
_el$1.$$click = hoisted2;
const template = _el$;
_$delegateEvents(["click"]);
