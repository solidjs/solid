import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { applyRef as _$applyRef } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
import { style as _$style } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { className as _$className } from "r-dom";
import { ref as _$ref } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><h1><a href="/">Welcome</a></h1></div>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><div></div><div> </div><div></div></div>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div foo></div>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div></div>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div class="a"className="b"></div>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div style="margin-right:40px"></div>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<div onclick="console.log('hi')"></div>`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<input type="checkbox"checked>`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<input type="checkbox">`),
  _tmpl$0 = /*#__PURE__*/ _$template(`<div class="\`a">\`$\`</div>`),
  _tmpl$1 = /*#__PURE__*/ _$template(`<button class="static hi"type="button">Write</button>`),
  _tmpl$10 = /*#__PURE__*/ _$template(`<button class="a b c">Hi</button>`),
  _tmpl$11 = /*#__PURE__*/ _$template(`<div><input readonly><input></div>`),
  _tmpl$12 = /*#__PURE__*/ _$template(`<div style="a:static"></div>`),
  _tmpl$13 = /*#__PURE__*/ _$template(`<div data="&quot;hi&quot;"data2="&quot;"></div>`),
  _tmpl$14 = /*#__PURE__*/ _$template(`<a></a>`),
  _tmpl$15 = /*#__PURE__*/ _$template(`<div><a></a></div>`),
  _tmpl$16 = /*#__PURE__*/ _$template(`<div>Hi</div>`),
  _tmpl$17 = /*#__PURE__*/ _$template(`<label><span>Input is </span><input><div></div></label>`),
  _tmpl$18 = /*#__PURE__*/ _$template(
    `<div class="class1 class2 class3 class4 class5 class6"random="random1 random2\n    random3 random4"style="color:red;background-color:blue !important;border:1px solid black;font-size:12px"></div>`
  ),
  _tmpl$19 = /*#__PURE__*/ _$template(`<button></button>`),
  _tmpl$20 = /*#__PURE__*/ _$template(`<input value="10">`),
  _tmpl$21 = /*#__PURE__*/ _$template(`<select><option>Red</option><option>Blue</option></select>`),
  _tmpl$22 = /*#__PURE__*/ _$template(`<img src>`),
  _tmpl$23 = /*#__PURE__*/ _$template(`<div><img src></div>`),
  _tmpl$24 = /*#__PURE__*/ _$template(`<img src loading="lazy">`, 1),
  _tmpl$25 = /*#__PURE__*/ _$template(`<div><img src loading="lazy"></div>`, 1),
  _tmpl$26 = /*#__PURE__*/ _$template(`<iframe src></iframe>`),
  _tmpl$27 = /*#__PURE__*/ _$template(`<div><iframe src></iframe></div>`),
  _tmpl$28 = /*#__PURE__*/ _$template(`<iframe src loading="lazy"></iframe>`, 1),
  _tmpl$29 = /*#__PURE__*/ _$template(`<div><iframe src loading="lazy"></iframe></div>`, 1),
  _tmpl$30 = /*#__PURE__*/ _$template(`<div title="&lt;u>data&lt;/u>"></div>`),
  _tmpl$31 = /*#__PURE__*/ _$template(`<div true truestr="true"truestrjs="true"></div>`),
  _tmpl$32 = /*#__PURE__*/ _$template(`<div falsestr="false"falsestrjs="false"></div>`),
  _tmpl$33 = /*#__PURE__*/ _$template(`<div true></div>`),
  _tmpl$34 = /*#__PURE__*/ _$template(`<div a b c d f="0"g h l></div>`),
  _tmpl$35 = /*#__PURE__*/ _$template(`<math display="block"><mrow></mrow></math>`),
  _tmpl$36 = /*#__PURE__*/ _$template(`<math><mrow><mi>x</mi><mo>=</mo></mrow></math>`, 2),
  _tmpl$37 = /*#__PURE__*/ _$template(`<div style="background:red"></div>`),
  _tmpl$38 = /*#__PURE__*/ _$template(
    `<div style="background:red;color:green;margin:3;padding:0.4"></div>`
  ),
  _tmpl$39 = /*#__PURE__*/ _$template(`<div style="background:red;color:green"></div>`),
  _tmpl$40 = /*#__PURE__*/ _$template(`<video></video>`),
  _tmpl$41 = /*#__PURE__*/ _$template(`<video playsinline></video>`),
  _tmpl$42 = /*#__PURE__*/ _$template(`<video poster="1.jpg"></video>`),
  _tmpl$43 = /*#__PURE__*/ _$template(`<div><video poster="1.jpg"></video></div>`),
  _tmpl$44 = /*#__PURE__*/ _$template(`<div><video></video></div>`),
  _tmpl$45 = /*#__PURE__*/ _$template(`<button type="button"></button>`),
  _tmpl$46 = /*#__PURE__*/ _$template(`<div style="padding-left:clamp(2px, 2px, 2px)"></div>`),
  _tmpl$47 = /*#__PURE__*/ _$template(`<div style="a:clamp(2px, 2px, 2px)"></div>`),
  _tmpl$48 = /*#__PURE__*/ _$template(`<div style="duplicate2"></div>`),
  _tmpl$49 = /*#__PURE__*/ _$template(
    `<div><input value="static attribute"><input><input value="static attribute"><input value="static property"><input><input><video muted></video><video></video><video muted></video><video></video><video></video><video muted></video><video></video></div>`
  ),
  _tmpl$50 = /*#__PURE__*/ _$template(
    `<div><textarea></textarea><textarea></textarea><textarea></textarea><textarea></textarea><textarea></textarea><textarea>static content</textarea><textarea>static content</textarea></div>`
  ),
  _tmpl$51 = /*#__PURE__*/ _$template(`<svg><a>xml link partial</a></svg>`, 2),
  _tmpl$52 = /*#__PURE__*/ _$template(`<video src="test.mp4"muted></video>`),
  _tmpl$53 = /*#__PURE__*/ _$template(`<input>`),
  _tmpl$54 = /*#__PURE__*/ _$template(`<div class="todo"></div>`),
  _tmpl$55 = /*#__PURE__*/ _$template(`<div class="todo item"></div>`);
import * as styles from "./styles.module.css";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let id = "my-h1";
let link;
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.firstChild;
_$spread(
  _el$,
  _$mergeProps(
    {
      id: "main"
    },
    results,
    {
      class: {
        selected: unknown
      },
      style: {
        color
      }
    }
  ),
  true
);
_$spread(
  _el$2,
  _$mergeProps(
    {
      id: "my-h1"
    },
    results,
    {
      foo: true,
      disabled: true,
      get title() {
        return welcoming();
      },
      get style() {
        return {
          "background-color": color(),
          "margin-right": "40px"
        };
      },
      get ["class"]() {
        return [
          "base",
          {
            dynamic: dynamic(),
            selected
          }
        ];
      }
    }
  ),
  true
);
var _ref$ = link;
typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => _ref$, _el$3) : (link = _el$3);
_$claimElement(_el$3);
_$className(_el$3, {
  "ccc ddd": true
});
const template = _el$;
var _el$4 = _tmpl$2(),
  _el$5 = _el$4.firstChild,
  _el$6 = _el$5.nextSibling,
  _el$7 = _el$6.firstChild,
  _el$8 = _el$6.nextSibling;
_$spread(
  _el$4,
  _$mergeProps(() => getProps("test")),
  true
);
_el$5.textContent = rowId;
_el$8.innerHTML = "<div/>";
_$effect(
  () => row.label,
  _v$ => {
    _el$7.data = _v$;
  }
);
const template2 = _el$4;
var _el$9 = _tmpl$3();
_$setAttribute(_el$9, "id", /*@static*/ state.id);
_$setStyleProperty(_el$9, "background-color", /*@static*/ state.color);
_el$9.textContent = /*@static*/ state.content;
_$effect(
  () => state.name,
  _v$ => {
    _$setAttribute(_el$9, "name", _v$);
  }
);
const template3 = _el$9;
var _el$0 = _tmpl$4();
_$className(_el$0, {
  "ccc:ddd": true
});
_$effect(
  () => state.class,
  _v$ => {
    _$setAttribute(_el$0, "className", _v$);
  }
);
const template4 = _el$0;
const template5 = _tmpl$5();
var _el$10 = _tmpl$4();
_el$10.textContent = "Hi";
_$effect(
  () => someStyle(),
  (_v$, _$p) => {
    _$style(_el$10, _v$, _$p);
  }
);
const template6 = _el$10;
let undefVar;
var _el$11 = _tmpl$6();
_el$11.classList.toggle("other-class2", !!undefVar);
_$effect(
  () => ({
    "background-color": color(),
    ...props.style
  }),
  (_v$, _$p) => {
    _$style(_el$11, _v$, _$p);
  }
);
const template7 = _el$11;
let refTarget;
var _el$12 = _tmpl$4();
var _ref$2 = refTarget;
typeof _ref$2 === "function" || Array.isArray(_ref$2)
  ? _$ref(() => _ref$2, _el$12)
  : (refTarget = _el$12);
const template8 = _el$12;
var _el$13 = _tmpl$4();
_$ref(() => e => console.log(e), _el$13);
const template9 = _el$13;
var _el$14 = _tmpl$4();
var _ref$3 = refFactory();
(typeof _ref$3 === "function" || Array.isArray(_ref$3)) && _$ref(() => _ref$3, _el$14);
const template10 = _el$14;
var _el$15 = _tmpl$7();
_el$15.htmlFor = thing;
_el$15.number = 123;
const template12 = _el$15;
const template13 = _tmpl$8();
var _el$17 = _tmpl$9();
_$effect(
  () => state.visible,
  _v$ => {
    _el$17.checked = _v$;
  }
);
const template14 = _el$17;
const template15 = _tmpl$0();
const template16 = _tmpl$1();
var _el$20 = _tmpl$10();
_$addEvent(_el$20, "click", increment, true);
const template17 = _el$20;
var _el$21 = _tmpl$4();
_$spread(
  _el$21,
  _$mergeProps(() => ({
    get [key()]() {
      return props.value;
    }
  })),
  false
);
const template18 = _el$21;
var _el$22 = _tmpl$4();
_$className(_el$22, [
  {
    "bg-red-500": true
  },
  "flex flex-col"
]);
const template19 = _el$22;
var _el$23 = _tmpl$11(),
  _el$24 = _el$23.firstChild,
  _el$25 = _el$24.nextSibling;
_$addEvent(_el$24, "input", doSomething, true);
_$addEvent(_el$25, "input", doSomethingElse, true);
_$setAttribute(_el$25, "readonly", value);
_$effect(
  () => ({
    e: s(),
    t: min(),
    a: max(),
    o: s2(),
    i: min(),
    n: max()
  }),
  ({ e, t, a, o, i, n }, _p$) => {
    _el$24.value = e ?? "";
    t !== _p$?.t && _$setAttribute(_el$24, "min", t);
    a !== _p$?.a && _$setAttribute(_el$24, "max", a);
    _el$25.checked = o;
    i !== _p$?.i && _$setAttribute(_el$25, "min", i);
    n !== _p$?.n && _$setAttribute(_el$25, "max", n);
  }
);
const template20 = _el$23;
var _el$26 = _tmpl$12();
_$effect(
  () => ({
    ...rest
  }),
  (_v$, _$p) => {
    _$style(_el$26, _v$, _$p);
  }
);
const template21 = _el$26;
const template22 = _tmpl$13();
var _el$28 = _tmpl$4();
_$insert(_el$28, () => "t" in test && "true");
_$effect(
  () => "t" in test,
  _v$ => {
    _$setAttribute(_el$28, "disabled", _v$);
  }
);
const template23 = _el$28;
var _el$29 = _tmpl$14();
_$claimElement(_el$29);
_$spread(
  _el$29,
  _$mergeProps(props, {
    something: true
  }),
  false
);
const template24 = _el$29;
var _el$30 = _tmpl$15(),
  _el$31 = _el$30.firstChild;
_$insert(_el$30, () => props.children, _el$31);
_$claimElement(_el$31);
_$spread(
  _el$31,
  _$mergeProps(props, {
    something: true
  }),
  false
);
const template25 = _el$30;
var _el$32 = _tmpl$16();
_$spread(
  _el$32,
  _$mergeProps(
    {
      start: "Hi",
      middle: middle
    },
    spread
  ),
  true
);
const template26 = _el$32;
var _el$33 = _tmpl$16();
_$spread(
  _el$33,
  _$mergeProps(
    {
      start: "Hi"
    },
    first,
    {
      middle: middle
    },
    second
  ),
  true
);
const template27 = _el$33;
var _el$34 = _tmpl$17(),
  _el$35 = _el$34.firstChild,
  _el$36 = _el$35.firstChild,
  _el$37 = _el$35.nextSibling,
  _el$38 = _el$37.nextSibling;
_$spread(_el$34, _$mergeProps(api), true);
_$spread(_el$35, _$mergeProps(api), true);
_$insert(_el$35, () => (api() ? "checked" : "unchecked"), null);
_$spread(_el$37, _$mergeProps(api), false);
_$spread(_el$38, _$mergeProps(api), false);
const template28 = _el$34;
var _el$39 = _tmpl$4();
_$setAttribute(_el$39, "attribute", !!someValue);
_$insert(_el$39, !!someValue);
const template29 = _el$39;
const template30 = _tmpl$18();
var _el$41 = _tmpl$4();
_$effect(
  () => getStore.itemProperties.color,
  _v$ => {
    _$setStyleProperty(_el$41, "background-color", _v$);
  }
);
const template31 = _el$41;
const template32 = _tmpl$4();
const template33 = [
  (() => {
    var _el$43 = _tmpl$19();
    _$effect(
      () => styles.button,
      (_v$, _$p) => {
        _$className(_el$43, _v$, _$p);
      }
    );
    return _el$43;
  })(),
  (() => {
    var _el$44 = _tmpl$19();
    _$effect(
      () => styles["foo--bar"],
      (_v$, _$p) => {
        _$className(_el$44, _v$, _$p);
      }
    );
    return _el$44;
  })(),
  (() => {
    var _el$45 = _tmpl$19();
    _$effect(
      () => styles.foo.bar,
      (_v$, _$p) => {
        _$className(_el$45, _v$, _$p);
      }
    );
    return _el$45;
  })(),
  (() => {
    var _el$46 = _tmpl$19();
    _$effect(
      () => styles[foo()],
      (_v$, _$p) => {
        _$className(_el$46, _v$, _$p);
      }
    );
    return _el$46;
  })()
];
var _el$47 = _tmpl$4();
var _ref$4 = a().b.c;
typeof _ref$4 === "function" || Array.isArray(_ref$4)
  ? _$ref(() => _ref$4, _el$47)
  : (a().b.c = _el$47);
const template35 = _el$47;
var _el$48 = _tmpl$4();
var _ref$5 = a().b?.c;
(typeof _ref$5 === "function" || Array.isArray(_ref$5)) && _$ref(() => _ref$5, _el$48);
const template36 = _el$48;
var _el$49 = _tmpl$4();
var _ref$6 = a() ? b : c;
(typeof _ref$6 === "function" || Array.isArray(_ref$6)) && _$ref(() => _ref$6, _el$49);
const template37 = _el$49;
var _el$50 = _tmpl$4();
var _ref$7 = a() ?? b;
(typeof _ref$7 === "function" || Array.isArray(_ref$7)) && _$ref(() => _ref$7, _el$50);
const template38 = _el$50;
const template39 = _tmpl$20();
var _el$52 = _tmpl$4();
_$effect(
  () => a(),
  _v$ => {
    _$setStyleProperty(_el$52, "color", _v$);
  }
);
const template40 = _el$52;
var _el$53 = _tmpl$21(),
  _el$54 = _el$53.firstChild,
  _el$55 = _el$54.nextSibling;
_$effect(
  () => ({
    e: state.color,
    t: Color.Red,
    a: Color.Blue
  }),
  ({ e, t, a }, _p$) => {
    queueMicrotask(() => (_el$53.value = e)) || (_el$53.value = e);
    _el$54.value = t;
    _el$55.value = a;
  }
);
const template41 = _el$53;
const template42 = _tmpl$22();
const template43 = _tmpl$23();
const template44 = _tmpl$24();
const template45 = _tmpl$25();
const template46 = _tmpl$26();
const template47 = _tmpl$27();
const template48 = _tmpl$28();
const template49 = _tmpl$29();
const template50 = _tmpl$30();
var _el$65 = _tmpl$4();
_$ref(() => binding, _el$65);
const template51 = _el$65;
var _el$66 = _tmpl$4();
var _ref$8 = binding.prop;
typeof _ref$8 === "function" || Array.isArray(_ref$8)
  ? _$ref(() => _ref$8, _el$66)
  : (binding.prop = _el$66);
const template52 = _el$66;
var _el$67 = _tmpl$4();
var _ref$9 = refFn;
typeof _ref$9 === "function" || Array.isArray(_ref$9)
  ? _$ref(() => _ref$9, _el$67)
  : (refFn = _el$67);
const template53 = _el$67;
var _el$68 = _tmpl$4();
_$ref(() => refConst, _el$68);
const template54 = _el$68;
var _el$69 = _tmpl$4();
var _ref$0 = refUnknown;
typeof _ref$0 === "function" || Array.isArray(_ref$0)
  ? _$ref(() => _ref$0, _el$69)
  : (refUnknown = _el$69);
const template55 = _el$69;
const template56 = _tmpl$31();
const template57 = _tmpl$32();
var _el$72 = _tmpl$4();
_el$72.true = true;
_el$72.false = false;
const template58 = _el$72;
const template59 = _tmpl$33();
var _el$74 = _tmpl$34();
_$setAttribute(_el$74, "i", undefined);
_$setAttribute(_el$74, "j", null);
_$setAttribute(_el$74, "k", void 0);
const template60 = _el$74;
const template61 = _tmpl$35();
const template62 = _tmpl$36();
const template63 = _tmpl$37();
const template64 = _tmpl$38();
const template65 = _tmpl$39();
var _el$80 = _tmpl$39();
_$effect(
  () => signal(),
  _v$ => {
    _$setStyleProperty(_el$80, "border", _v$);
  }
);
const template66 = _el$80;
var _el$81 = _tmpl$39();
_$setStyleProperty(_el$81, "border", somevalue);
const template67 = _el$81;
var _el$82 = _tmpl$39();
_$effect(
  () => some.access,
  _v$ => {
    _$setStyleProperty(_el$82, "border", _v$);
  }
);
const template68 = _el$82;
const template69 = _tmpl$39();
var _el$84 = _tmpl$40();
_$setAttribute(_el$84, "playsinline", value);
const template70 = _el$84;
const template71 = _tmpl$41();
const template72 = _tmpl$40();
const template73 = _tmpl$42();
const template74 = _tmpl$43();
var _el$89 = _tmpl$40();
_el$89.poster = "1.jpg";
const template75 = _el$89;
var _el$90 = _tmpl$44(),
  _el$91 = _el$90.firstChild;
_el$91.poster = "1.jpg";
const template76 = _el$90;
var _el$92 = _tmpl$4();
_$setStyleProperty(_el$92, "width", /*@static*/ props.width);
_$setStyleProperty(_el$92, "height", props.height);
const template77 = _el$92;
var _el$93 = _tmpl$4();
_$setStyleProperty(_el$93, "width", /*@static*/ props.width);
_$setStyleProperty(_el$93, "height", props.height);
_$effect(
  () => color(),
  _v$ => {
    _$setAttribute(_el$93, "something", _v$);
  }
);
const template78 = _el$93;
var _el$94 = _tmpl$4();
_$setStyleProperty(_el$94, "height", /* @static */ props.height);
_$setAttribute(_el$94, "something", /*@static*/ color());
_$effect(
  () => props.width,
  _v$ => {
    _$setStyleProperty(_el$94, "width", _v$);
  }
);
const template79 = _el$94;
const propsSpread = {
  something: color(),
  style: {
    "background-color": color(),
    color: /* @static*/ color(),
    "margin-right": /* @static */ props.right
  }
};
var _el$95 = _tmpl$4();
_$spread(_el$95, propsSpread, false);
const template80 = _el$95;
var _el$96 = _tmpl$4();
_$spread(
  _el$96,
  {
    ...propsSpread
  },
  false
);
const template81 = _el$96;
var _el$97 = _tmpl$4();
_$spread(
  _el$97,
  _$mergeProps(propsSpread, {
    get ["data-dynamic"]() {
      return color();
    },
    "data-static": /* @static */ color()
  }),
  false
);
const template82 = _el$97;
var _el$98 = _tmpl$4();
_$spread(
  _el$98,
  _$mergeProps(
    {
      ...propsSpread
    },
    {
      get ["data-dynamic"]() {
        return color();
      },
      "data-static": /* @static */ color()
    }
  ),
  false
);
const template83 = _el$98;
var _el$99 = _tmpl$4();
_$spread(
  _el$99,
  _$mergeProps(
    {
      ...propsSpread1
    },
    propsSpread2,
    {
      ...propsSpread3
    },
    {
      get ["data-dynamic"]() {
        return color();
      },
      "data-static": /* @static */ color()
    }
  ),
  false
);
const template84 = _el$99;

/* https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563 */

const styleProp = {
  style: {
    width: props.width,
    height: props.height
  }
};
var _el$100 = _tmpl$4();
_$style(_el$100, /* @static */ styleProp.style);
const template85 = _el$100;
var _el$101 = _tmpl$4();
_$effect(
  () => styleProp.style,
  (_v$, _$p) => {
    _$style(_el$101, _v$, _$p);
  }
);
const template86 = _el$101;
const style = {
  background: "red",
  border: "solid black " + count() + "px"
};
var _el$102 = _tmpl$45();
_$insert(_el$102, count);
_$effect(
  () => ({
    e: count(),
    t: style,
    a: style
  }),
  ({ e, t, a }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$102, "aria-label", e);
    _$style(_el$102, t, _p$?.t);
    _$className(_el$102, a, _p$?.a);
  }
);
const template87 = _el$102;
var _el$103 = _tmpl$45();
_$style(_el$103, /* @static*/ style);
_$className(_el$103, /* @static*/ style);
_$insert(_el$103, count);
_$effect(
  () => count(),
  _v$ => {
    _$setAttribute(_el$103, "aria-label", _v$);
  }
);
const template88 = _el$103;
{
  _tmpl$46();
}
{
  _tmpl$47();
}
{
  (() => {
    var _el$106 = _tmpl$4();
    _$effect(
      () => ({
        [computedkey]: "clamp(2px, 2px, 2px)"
      }),
      (_v$, _$p) => {
        _$style(_el$106, _v$, _$p);
      }
    );
    return _el$106;
  })();
}
{
  const o = {
    ref: null
  };
  const Div = _ => [];
  const valid = _$createComponent(Div, {
    ref(r$) {
      var _ref$1 = o.ref;
      typeof _ref$1 === "function" || Array.isArray(_ref$1) ? _$applyRef(_ref$1, r$) : (o.ref = r$);
    }
  });
  const invalid = _$createComponent(Div, {
    ref(r$) {
      var _ref$10 = o?.ref;
      typeof _ref$10 === "function" || Array.isArray(_ref$10)
        ? _$applyRef(_ref$10, r$)
        : !!o && (o.ref = r$);
    }
  });
}
const template89 = _tmpl$4();
const template90 = _tmpl$4();
var _el$109 = _tmpl$40();
_$setAttribute(_el$109, "something", {
  value: {
    value: 2
  }
});
const template91 = _el$109;
const template92 = _tmpl$48();
var _el$111 = _tmpl$49(),
  _el$112 = _el$111.firstChild,
  _el$113 = _el$112.nextSibling,
  _el$114 = _el$113.nextSibling,
  _el$115 = _el$114.nextSibling,
  _el$116 = _el$115.nextSibling,
  _el$117 = _el$116.nextSibling,
  _el$118 = _el$117.nextSibling,
  _el$119 = _el$118.nextSibling,
  _el$120 = _el$119.nextSibling,
  _el$121 = _el$120.nextSibling,
  _el$122 = _el$121.nextSibling,
  _el$123 = _el$122.nextSibling,
  _el$124 = _el$123.nextSibling;
_el$113.value = "static property";
_$effect(
  () => ({
    e: dynamicProperty(),
    t: dynamicAttribute(),
    a: dynamicProperty(),
    o: dynamicAttribute(),
    i: dynamicProperty(),
    n: dynamicProperty(),
    s: dynamicProperty(),
    h: dynamicAttribute(),
    r: dynamicProperty()
  }),
  ({ e, t, a, o, i, n, s, h, r }, _p$) => {
    _el$112.value = e ?? "";
    t !== _p$?.t && (_el$113.defaultValue = t ?? "");
    _el$116.value = a ?? "";
    o !== _p$?.o && (_el$117.defaultValue = o ?? "");
    _el$117.value = i ?? "";
    _el$122.muted = n;
    _el$123.muted = s;
    h !== _p$?.h && (_el$124.defaultMuted = h);
    _el$124.muted = r;
  }
);
const template93 = _el$111;
var _el$125 = _tmpl$50(),
  _el$126 = _el$125.firstChild,
  _el$127 = _el$126.nextSibling,
  _el$128 = _el$127.nextSibling,
  _el$129 = _el$128.nextSibling,
  _el$130 = _el$129.nextSibling;
_$insert(_el$127, dynamicContent);
_$insert(_el$130, dynamicContent);
_$effect(
  () => ({
    e: dynamicProperty(),
    t: dynamicProperty(),
    a: dynamicContent(),
    o: dynamicProperty(),
    i: dynamicProperty()
  }),
  ({ e, t, a, o, i }, _p$) => {
    _el$126.value = e ?? "";
    _el$127.value = t ?? "";
    a !== _p$?.a && (_el$128.defaultValue = a ?? "");
    _el$128.value = o ?? "";
    _el$129.value = i ?? "";
  }
);
const template94 = _el$125;
const template95 = _tmpl$51();
const template96 = _tmpl$52();
function MyVideo() {
  return _tmpl$52();
}
var _el$134 = _tmpl$53();
_$spread(
  _el$134,
  _$mergeProps(
    {
      get value() {
        return get();
      }
    },
    {
      style: "color:red"
    }
  ),
  false
);
const template97 = _el$134;
var _el$135 = _tmpl$54();
_$effect(
  () => !!isActive(),
  _v$ => {
    _el$135.classList.toggle("active", _v$);
  }
);
const template98 = _el$135;
var _el$136 = _tmpl$4();
_$effect(
  () => ["todo", props.active],
  (_v$, _$p) => {
    _$className(_el$136, _v$, _$p);
  }
);
const template99 = _el$136;
var _el$137 = _tmpl$55();
_$effect(
  () => !!isActive(),
  _v$ => {
    _el$137.classList.toggle("active", _v$);
  }
);
const template100 = _el$137;
var _el$138 = _tmpl$4();
_$effect(
  () => [
    "todo",
    {
      active: isActive(),
      [props.name]: props.enabled
    }
  ],
  (_v$, _$p) => {
    _$className(_el$138, _v$, _$p);
  }
);
const template101 = _el$138;
var _el$139 = _tmpl$4();
_$effect(
  () => [
    "todo",
    {
      active: isActive()
    },
    props.extra
  ],
  (_v$, _$p) => {
    _$className(_el$139, _v$, _$p);
  }
);
const template102 = _el$139;
var _el$140 = _tmpl$4();
_$effect(
  () => [
    "todo",
    "item",
    {
      todo: false,
      active: isActive()
    }
  ],
  (_v$, _$p) => {
    _$className(_el$140, _v$, _$p);
  }
);
const template103 = _el$140;
_$delegateEvents(["click", "input"]);
