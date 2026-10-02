import { ssrElement as _$ssrElement } from "r-server";
import { ssrElementAttribute as _$ssrElementAttribute } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _tmpl$ = [
    "<div",
    ' id="main"><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated</button></div>'
  ],
  _tmpl$2 = [
    "<div",
    "><button onclick=\"console.log('static')\">Static Attribute</button><button",
    ">Identifier Attribute</button><button",
    ">Dynamic Attribute</button><button",
    ">Function Attribute</button>",
    "</div>"
  ];
var _sk$ = k => k === "onclick";
function hoistedCustomEvent1() {
  console.log("hoisted");
}
const hoistedcustomevent2 = () => console.log("hoisted");
var _v$ = _$ssrHydrationKey();
const template = _$ssr(_tmpl$, _v$);
var _v$2 = _$ssrHydrationKey(),
  _v$3 = () => _$ssrAttribute("onmouseover", _$escape(state.code, true)),
  _v$4 = _$ssrElement(
    "button",
    rest,
    () => "Spread Attribute",
    false,
    _sk$,
    () => _$ssrElementAttribute("onclick", code)
  );
const lowercaseAttributes = _$ssr(
  _tmpl$2,
  _v$2,
  _$ssrAttribute("onclick", _$escape(code, true)),
  _v$3,
  _$ssrAttribute("onclick", () => _$escape(console.log("not a handler"), true)),
  _v$4
);
