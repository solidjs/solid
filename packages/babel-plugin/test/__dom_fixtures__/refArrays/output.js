import { template as _$template } from "r-dom";
import { ref as _$ref } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>`);
// Bare variables inside a ref array must be assigned at mount (#3285).
let elementRef;
var _el$ = _tmpl$();
_$ref(
  () => [
    _el$2 => {
      var _ref$ = elementRef;
      typeof _ref$ === "function" ? _ref$(_el$2) : (elementRef = _el$2);
    }
  ],
  _el$
);
const el1 = _el$;

// Multiple bare variables, each gets its own assignment callback.
let a, b;
var _el$3 = _tmpl$();
_$ref(
  () => [
    _el$4 => {
      var _ref$2 = a;
      typeof _ref$2 === "function" ? _ref$2(_el$4) : (a = _el$4);
    },
    _el$5 => {
      var _ref$3 = b;
      typeof _ref$3 === "function" ? _ref$3(_el$5) : (b = _el$5);
    }
  ],
  _el$3
);
const el2 = _el$3;

// Callback refs keep working and pass through untouched.
var _el$6 = _tmpl$();
_$ref(() => [node => calls.push(node)], _el$6);
const el3 = _el$6;

// Member-expression targets are assignment callbacks too.
const holder = {};
var _el$7 = _tmpl$();
_$ref(
  () => [
    _el$8 => {
      var _ref$4 = holder.el;
      typeof _ref$4 === "function" ? _ref$4(_el$8) : (holder.el = _el$8);
    }
  ],
  _el$7
);
const el4 = _el$7;

// Nested arrays are recursed so runtime flattening reaches every callback.
let nested;
var _el$9 = _tmpl$();
_$ref(
  () => [
    [
      _el$0 => {
        var _ref$5 = nested;
        typeof _ref$5 === "function" ? _ref$5(_el$0) : (nested = _el$0);
      }
    ]
  ],
  _el$9
);
const el5 = _el$9;

// Falsy/placeholder slots stay as-is (the runtime short-circuits them);
// globals like `undefined` are never treated as assignment targets.
var _el$1 = _tmpl$();
_$ref(() => [null, undefined, false], _el$1);
const el6 = _el$1;

// A mutable binding that currently holds a function is *called*, not
// overwritten — same contract as the non-array lval ref branch.
let cb = () => {};
var _el$10 = _tmpl$();
_$ref(
  () => [
    _el$11 => {
      var _ref$6 = cb;
      typeof _ref$6 === "function" ? _ref$6(_el$11) : (cb = _el$11);
    }
  ],
  _el$10
);
const el7 = _el$10;
