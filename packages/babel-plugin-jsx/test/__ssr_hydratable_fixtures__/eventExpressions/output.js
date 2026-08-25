import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _tmpl$ = [
  "<div",
  ' id="main"><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated</button></div>'
];
function hoistedCustomEvent1() {
  console.log("hoisted");
}
const hoistedcustomevent2 = () => console.log("hoisted");
var _v$ = _$ssrHydrationKey();
const template = _$ssr(_tmpl$, _v$);
