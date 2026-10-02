import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { effect as _$effect } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
    `<div id=main><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated`
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<div><button onclick="console.log('static')">Static Attribute</button><button>Identifier Attribute</button><button>Dynamic Attribute</button><button>Function Attribute</button><button>Spread Attribute`
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
_el$7._$$click = () => console.log("delegated");
_el$8._$$click = id => console.log("delegated", id);
_el$8._$$clickData = rowId;
_$addEvent(_el$9, "click", handler, true);
_el$0._$$click = handler;
_el$1._$$click = hoisted2;
const template = _el$;
var _el$10 = _tmpl$2(),
  _el$11 = _el$10.firstChild,
  _el$12 = _el$11.nextSibling,
  _el$13 = _el$12.nextSibling,
  _el$14 = _el$13.nextSibling,
  _el$15 = _el$14.nextSibling;
_$setAttribute(_el$12, "onclick", code);
_$setAttribute(_el$14, "onclick", () => console.log("not a handler"));
_$spread(
  _el$15,
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
    _$setAttribute(_el$13, "onmouseover", _v$);
  }
);
const lowercaseAttributes = _el$10;
_$delegateEvents(["click"]);
