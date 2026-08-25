import { ssrSelectValues as _$ssrSelectValues } from "r-server";
import { scope as _$scope } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyle as _$ssrStyle } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrStyleProperty as _$ssrStyleProperty } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { memo as _$memo } from "r-server";
import { escape as _$escape } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
import { ssr as _$ssr } from "r-server";
var _ref$, _v$, _v$2, _v$44, _v$45, _v$46, _v$47, _v$48, _v$49;
var _tmpl$ = ['<a href="/" class="', '">Welcome</a>'],
  _tmpl$2 = ["<div>", "</div>"],
  _tmpl$3 = "<div><div/></div>",
  _tmpl$4 = ["<div", " foo", ' style="', '"', ">", "</div>"],
  _tmpl$5 = ["<div", "", ' class="', '"></div>'],
  _tmpl$6 = ["<div", ' class="a" className="b"></div>'],
  _tmpl$7 = ["<div", ' style="', '">Hi</div>'],
  _tmpl$8 = ["<div", ' style="', '" class="', '"></div>'],
  _tmpl$9 = ["<div", "></div>"],
  _tmpl$0 = ["<div", " onclick=\"console.log('hi')\"></div>"],
  _tmpl$1 = ["<input", ' type="checkbox" checked>'],
  _tmpl$10 = ["<input", ' type="checkbox"', ">"],
  _tmpl$11 = ["<div", ' class="`a">`$`</div>'],
  _tmpl$12 = ["<button", ' class="', '" type="button">Write</button>'],
  _tmpl$13 = ["<button", ' class="', '">Hi</button>'],
  _tmpl$14 = ["<div", ' class="', '"></div>'],
  _tmpl$15 = ["<div", "><input", "", "", " readonly><input", "", "", "", "></div>"],
  _tmpl$16 = ["<div", ' style="', '"></div>'],
  _tmpl$17 = ["<div", ' data="&quot;hi&quot;" data2="&quot;"></div>'],
  _tmpl$18 = ["<div", "", ">", "</div>"],
  _tmpl$19 = ["<div", "><!--$-->", "<!--/-->", "</div>"],
  _tmpl$20 = [
    "<div",
    ' class="class1 class2 class3 class4 class5 class6" style="color:red;background-color:blue !important;border:1px solid black;font-size:12px;" random="random1 random2\n    random3 random4"></div>'
  ],
  _tmpl$21 = ["<button", ' class="', '"></button>'],
  _tmpl$22 = ["<input", ' value="10">'],
  _tmpl$23 = ["<select", "", "><option", ">Red</option><option", ">Blue</option></select>"],
  _tmpl$24 = ["<img", " src>"],
  _tmpl$25 = ["<div", "><img src></div>"],
  _tmpl$26 = ["<img", ' src loading="lazy">'],
  _tmpl$27 = ["<div", '><img src loading="lazy"></div>'],
  _tmpl$28 = ["<iframe", " src></iframe>"],
  _tmpl$29 = ["<div", "><iframe src></iframe></div>"],
  _tmpl$30 = ["<iframe", ' src loading="lazy"></iframe>'],
  _tmpl$31 = ["<div", '><iframe src loading="lazy"></iframe></div>'],
  _tmpl$32 = ["<div", ' title="&lt;u>data&lt;/u>"></div>'],
  _tmpl$33 = ["<div", ' true truestr="true" truestrjs="true"></div>'],
  _tmpl$34 = ["<div", ' falsestr="false" falsestrjs="false"></div>'],
  _tmpl$35 = ["<div", " true></div>"],
  _tmpl$36 = ["<div", ' a b c d f="0" g h', "", "", " l></div>"],
  _tmpl$37 = ["<math", ' display="block"><mrow></mrow></math>'],
  _tmpl$38 = ["<mrow", "><mi>x</mi><mo>=</mo></mrow>"],
  _tmpl$39 = ["<video", "", "></video>"],
  _tmpl$40 = ["<video", " playsinline></video>"],
  _tmpl$41 = ["<video", "></video>"],
  _tmpl$42 = ["<video", ' poster="1.jpg"></video>'],
  _tmpl$43 = ["<div", '><video poster="1.jpg"></video></div>'],
  _tmpl$44 = ["<div", "><video></video></div>"],
  _tmpl$45 = ["<div", ' style="', '"', "></div>"],
  _tmpl$46 = ["<button", ' type="button"', ' style="', '" class="', '">', "</button>"],
  _tmpl$47 = ["<div", "", "></div>"],
  _tmpl$48 = [
    "<div",
    "><video muted></video><video></video><video></video><video muted></video><video",
    '></video><video src="test.mp4" muted></video></div>'
  ],
  _tmpl$49 = ["<video", ' src="test.mp4" muted></video>'],
  _tmpl$50 = ["<div", "><div>", "</div><div>", '</div><input type="checkbox"', "></div>"];
_$ssrSelectValues();
import * as styles from "./styles.module.css";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let id = "my-h1";
let link;
const template = _$ssrElement(
  "div",
  () =>
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
  () =>
    _$ssrElement(
      "h1",
      () =>
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
      () => ((_ref$ = link), _$ssr(_tmpl$, "ccc ddd")),
      false
    ),
  true
);
const template2 = _$ssrElement(
  "div",
  getProps("test"),
  () => [
    ((_v$ = _$escape(rowId || " ")), _$ssr(_tmpl$2, _v$)),
    ((_v$2 = () => _$escape(row.label || " ")), _$ssr(_tmpl$2, _v$2)),
    _$ssr(_tmpl$3)
  ],
  true
);
var _v$3 = _$ssrHydrationKey(),
  _g$ = _$ssrGroup(
    () => [
      _$ssrAttribute("name", _$escape(state.name, true)),
      _$escape(/*@static*/ state.content || " ")
    ],
    2
  );
const template3 = _$ssr(
  _tmpl$4,
  _v$3,
  _$ssrAttribute("id", _$escape(state.id, true)),
  _$ssrStyleProperty("background-color:", _$escape(state.color, true)),
  _g$,
  _g$
);
var _v$6 = _$ssrHydrationKey(),
  _v$7 = () => _$ssrAttribute("className", _$escape(state.class, true));
const template4 = _$ssr(_tmpl$5, _v$6, _v$7, "ccc:ddd");
var _v$8 = _$ssrHydrationKey();
const template5 = _$ssr(_tmpl$6, _v$8);
var _v$9 = _$ssrHydrationKey(),
  _v$0 = () => _$ssrStyle(someStyle());
const template6 = _$ssr(_tmpl$7, _v$9, _v$0);
let undefVar;
var _v$1 = _$ssrHydrationKey(),
  _v$10 = () =>
    _$ssrStyle({
      "background-color": color(),
      "margin-right": "40px",
      ...props.style
    });
const template7 = _$ssr(_tmpl$8, _v$1, _v$10, undefVar ? "other-class2" : "");
let refTarget;
var _v$11 = _$ssrHydrationKey(),
  _ref$2 = refTarget;
const template8 = _$ssr(_tmpl$9, _v$11);
var _v$12 = _$ssrHydrationKey(),
  _ref$3 = e => console.log(e);
const template9 = _$ssr(_tmpl$9, _v$12);
var _v$13 = _$ssrHydrationKey(),
  _ref$4 = refFactory();
const template10 = _$ssr(_tmpl$9, _v$13);
var _v$14 = _$ssrHydrationKey();
const template12 = _$ssr(_tmpl$0, _v$14);
var _v$15 = _$ssrHydrationKey();
const template13 = _$ssr(_tmpl$1, _v$15);
var _v$16 = _$ssrHydrationKey(),
  _v$17 = () => _$ssrAttribute("checked", _$escape(state.visible, true));
const template14 = _$ssr(_tmpl$10, _v$16, _v$17);
var _v$18 = _$ssrHydrationKey();
const template15 = _$ssr(_tmpl$11, _v$18);
var _v$19 = _$ssrHydrationKey();
const template16 = _$ssr(
  _tmpl$12,
  _v$19,
  _$ssrClassName([
    "static",
    {
      hi: "k"
    }
  ])
);
var _v$20 = _$ssrHydrationKey();
const template17 = _$ssr(_tmpl$13, _v$20, "a  b  c");
const template18 = _$ssrElement(
  "div",
  {
    get [key()]() {
      return props.value;
    }
  },
  undefined,
  true
);
var _v$21 = _$ssrHydrationKey();
const template19 = _$ssr(
  _tmpl$14,
  _v$21,
  _$ssrClassName([
    {
      "bg-red-500": true
    },
    "flex flex-col"
  ])
);
var _v$22 = _$ssrHydrationKey(),
  _g$3 = _$ssrGroup(
    () => [
      _$ssrAttribute("min", _$escape(min(), true)),
      _$ssrAttribute("max", _$escape(max(), true))
    ],
    2
  ),
  _g$2 = _$ssrGroup(
    () => [
      _$ssrAttribute("min", _$escape(min(), true)),
      _$ssrAttribute("max", _$escape(max(), true))
    ],
    2
  ),
  _v$23 = () => _$ssrAttribute("value", _$escape(s(), true)),
  _v$26 = () => _$ssrAttribute("checked", _$escape(s2(), true));
const template20 = _$ssr(
  _tmpl$15,
  _v$22,
  _v$23,
  _g$3,
  _g$3,
  _v$26,
  _g$2,
  _g$2,
  _$ssrAttribute("readonly", _$escape(value, true))
);
var _v$29 = _$ssrHydrationKey(),
  _v$30 = () =>
    _$ssrStyle({
      a: "static",
      ...rest
    });
const template21 = _$ssr(_tmpl$16, _v$29, _v$30);
var _v$31 = _$ssrHydrationKey();
const template22 = _$ssr(_tmpl$17, _v$31);
var _v$32 = _$ssrHydrationKey(),
  _v$33 = () => _$ssrAttribute("disabled", "t" in _$escape(test, true)),
  _v$34 = () => "t" in test && "true";
const template23 = _$ssr(_tmpl$18, _v$32, _v$33, _v$34);
const template24 = _$ssrElement(
  "a",
  () =>
    _$mergeProps(props, {
      something: true
    }),
  undefined,
  true
);
var _v$35 = _$ssrHydrationKey(),
  _v$36 = _$scope(() => _$escape(props.children)),
  _v$37 = _$ssrElement(
    "a",
    () =>
      _$mergeProps(props, {
        something: true
      }),
    undefined,
    false
  );
const template25 = _$ssr(_tmpl$19, _v$35, _v$36, _v$37);
const template26 = _$ssrElement(
  "div",
  () =>
    _$mergeProps(
      {
        start: "Hi",
        middle: middle
      },
      spread
    ),
  () => "Hi",
  true
);
const template27 = _$ssrElement(
  "div",
  () =>
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
  () => "Hi",
  true
);
const template28 = _$ssrElement(
  "label",
  api(),
  () => [
    _$ssrElement(
      "span",
      api(),
      () => ["Input is ", "<!--$-->", () => (api() ? "checked" : "unchecked"), "<!--/-->"],
      false
    ),
    _$ssrElement("input", api(), undefined, false),
    _$ssrElement("div", api(), undefined, false)
  ],
  true
);
var _v$38 = _$ssrHydrationKey(),
  _v$39 = !!someValue;
const template29 = _$ssr(_tmpl$18, _v$38, _$ssrAttribute("attribute", !!someValue), _v$39);
var _v$40 = _$ssrHydrationKey();
const template30 = _$ssr(_tmpl$20, _v$40);
var _v$41 = _$ssrHydrationKey(),
  _v$42 = () =>
    _$ssrStyleProperty("background-color:", _$escape(getStore.itemProperties.color, true));
const template31 = _$ssr(_tmpl$16, _v$41, _v$42);
var _v$43 = _$ssrHydrationKey();
const template32 = _$ssr(
  _tmpl$16,
  _v$43,
  _$ssrStyleProperty("background-color:", _$escape(undefined, true))
);
const template33 = [
  ((_v$44 = _$ssrHydrationKey()), _$ssr(_tmpl$21, _v$44, _$ssrClassName(styles.button))),
  ((_v$45 = _$ssrHydrationKey()), _$ssr(_tmpl$21, _v$45, _$ssrClassName(styles["foo--bar"]))),
  ((_v$46 = _$ssrHydrationKey()),
  (_v$47 = () => _$ssrClassName(styles.foo.bar)),
  _$ssr(_tmpl$21, _v$46, _v$47)),
  ((_v$48 = _$ssrHydrationKey()),
  (_v$49 = () => _$ssrClassName(styles[foo()])),
  _$ssr(_tmpl$21, _v$48, _v$49))
];
var _v$50 = _$ssrHydrationKey(),
  _ref$5 = a().b.c;
const template35 = _$ssr(_tmpl$9, _v$50);
var _v$51 = _$ssrHydrationKey(),
  _ref$6 = a().b?.c;
const template36 = _$ssr(_tmpl$9, _v$51);
var _v$52 = _$ssrHydrationKey(),
  _ref$7 = a() ? b : c;
const template37 = _$ssr(_tmpl$9, _v$52);
var _v$53 = _$ssrHydrationKey(),
  _ref$8 = a() ?? b;
const template38 = _$ssr(_tmpl$9, _v$53);
var _v$54 = _$ssrHydrationKey();
const template39 = _$ssr(_tmpl$22, _v$54);
var _v$55 = _$ssrHydrationKey(),
  _v$56 = () => _$ssrStyleProperty("color:", _$escape(a(), true));
const template40 = _$ssr(_tmpl$16, _v$55, _v$56);
var _v$57 = _$ssrHydrationKey(),
  _v$58 = () => _$ssrAttribute("value", _$escape(state.color, true)),
  _v$59 = () => _$ssrAttribute("value", _$escape(Color.Red, true)),
  _v$60 = () => _$ssrAttribute("value", _$escape(Color.Blue, true));
const template41 = _$ssr(_tmpl$23, _v$57, _v$58, _v$59, _v$60);
var _v$61 = _$ssrHydrationKey();
const template42 = _$ssr(_tmpl$24, _v$61);
var _v$62 = _$ssrHydrationKey();
const template43 = _$ssr(_tmpl$25, _v$62);
var _v$63 = _$ssrHydrationKey();
const template44 = _$ssr(_tmpl$26, _v$63);
var _v$64 = _$ssrHydrationKey();
const template45 = _$ssr(_tmpl$27, _v$64);
var _v$65 = _$ssrHydrationKey();
const template46 = _$ssr(_tmpl$28, _v$65);
var _v$66 = _$ssrHydrationKey();
const template47 = _$ssr(_tmpl$29, _v$66);
var _v$67 = _$ssrHydrationKey();
const template48 = _$ssr(_tmpl$30, _v$67);
var _v$68 = _$ssrHydrationKey();
const template49 = _$ssr(_tmpl$31, _v$68);
var _v$69 = _$ssrHydrationKey();
const template50 = _$ssr(_tmpl$32, _v$69);
var _v$70 = _$ssrHydrationKey(),
  _ref$9 = binding;
const template51 = _$ssr(_tmpl$9, _v$70);
var _v$71 = _$ssrHydrationKey(),
  _ref$0 = binding.prop;
const template52 = _$ssr(_tmpl$9, _v$71);
var _v$72 = _$ssrHydrationKey(),
  _ref$1 = refFn;
const template53 = _$ssr(_tmpl$9, _v$72);
var _v$73 = _$ssrHydrationKey(),
  _ref$10 = refConst;
const template54 = _$ssr(_tmpl$9, _v$73);
var _v$74 = _$ssrHydrationKey(),
  _ref$11 = refUnknown;
const template55 = _$ssr(_tmpl$9, _v$74);
var _v$75 = _$ssrHydrationKey();
const template56 = _$ssr(_tmpl$33, _v$75);
var _v$76 = _$ssrHydrationKey();
const template57 = _$ssr(_tmpl$34, _v$76);
var _v$77 = _$ssrHydrationKey();
const template58 = _$ssr(_tmpl$9, _v$77);
var _v$78 = _$ssrHydrationKey();
const template59 = _$ssr(_tmpl$35, _v$78);
var _v$79 = _$ssrHydrationKey();
const template60 = _$ssr(
  _tmpl$36,
  _v$79,
  _$ssrAttribute("i", _$escape(undefined, true)),
  _$ssrAttribute("j", _$escape(null, true)),
  _$ssrAttribute("k", void 0)
);
var _v$80 = _$ssrHydrationKey();
const template61 = _$ssr(_tmpl$37, _v$80);
var _v$81 = _$ssrHydrationKey();
const template62 = _$ssr(_tmpl$38, _v$81);
var _v$82 = _$ssrHydrationKey();
const template63 = _$ssr(_tmpl$16, _v$82, _$ssrStyleProperty("background:", "red"));
var _v$83 = _$ssrHydrationKey();
const template64 = _$ssr(
  _tmpl$16,
  _v$83,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";margin:", 3) +
    _$ssrStyleProperty(";padding:", 0.4)
);
var _v$84 = _$ssrHydrationKey();
const template65 = _$ssr(
  _tmpl$16,
  _v$84,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(undefined, true))
);
var _v$85 = _$ssrHydrationKey(),
  _v$86 = () =>
    _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(signal(), true));
const template66 = _$ssr(_tmpl$16, _v$85, _v$86);
var _v$87 = _$ssrHydrationKey();
const template67 = _$ssr(
  _tmpl$16,
  _v$87,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(somevalue, true))
);
var _v$88 = _$ssrHydrationKey(),
  _v$89 = () =>
    _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(some.access, true));
const template68 = _$ssr(_tmpl$16, _v$88, _v$89);
var _v$90 = _$ssrHydrationKey();
const template69 = _$ssr(
  _tmpl$16,
  _v$90,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(null, true))
);
var _v$91 = _$ssrHydrationKey();
const template70 = _$ssr(_tmpl$39, _v$91, _$ssrAttribute("playsinline", _$escape(value, true)));
var _v$92 = _$ssrHydrationKey();
const template71 = _$ssr(_tmpl$40, _v$92);
var _v$93 = _$ssrHydrationKey();
const template72 = _$ssr(_tmpl$41, _v$93);
var _v$94 = _$ssrHydrationKey();
const template73 = _$ssr(_tmpl$42, _v$94);
var _v$95 = _$ssrHydrationKey();
const template74 = _$ssr(_tmpl$43, _v$95);
var _v$96 = _$ssrHydrationKey();
const template75 = _$ssr(_tmpl$41, _v$96);
var _v$97 = _$ssrHydrationKey();
const template76 = _$ssr(_tmpl$44, _v$97);

// STATIC TESTS
var _v$98 = _$ssrHydrationKey();
const template77 = _$ssr(
  _tmpl$16,
  _v$98,
  _$ssrStyleProperty("width:", _$escape(props.width, true)) +
    _$ssrStyleProperty(";height:", _$escape(props.height, true))
);
var _v$99 = _$ssrHydrationKey(),
  _v$100 = () => _$ssrAttribute("something", _$escape(color(), true));
const template78 = _$ssr(
  _tmpl$45,
  _v$99,
  _$ssrStyleProperty("width:", _$escape(props.width, true)) +
    _$ssrStyleProperty(";height:", _$escape(props.height, true)),
  _v$100
);
var _v$101 = _$ssrHydrationKey(),
  _v$102 = () =>
    _$ssrStyleProperty("width:", _$escape(props.width, true)) +
    _$ssrStyleProperty(";height:", _$escape(/* @static */ props.height, true));
const template79 = _$ssr(
  _tmpl$45,
  _v$101,
  _v$102,
  _$ssrAttribute("something", _$escape(color(), true))
);

// STATIC TESTS SPREADS

const propsSpread = {
  something: color(),
  style: {
    "background-color": color(),
    color: /* @static*/ color(),
    "margin-right": /* @static */ props.right
  }
};
const template80 = _$ssrElement("div", propsSpread, undefined, true);
const template81 = _$ssrElement("div", propsSpread, undefined, true);
const template82 = _$ssrElement(
  "div",
  () =>
    _$mergeProps(propsSpread, {
      get ["data-dynamic"]() {
        return color();
      },
      "data-static": color()
    }),
  undefined,
  true
);
const template83 = _$ssrElement(
  "div",
  () =>
    _$mergeProps(propsSpread, {
      get ["data-dynamic"]() {
        return color();
      },
      "data-static": color()
    }),
  undefined,
  true
);
const template84 = _$ssrElement(
  "div",
  () =>
    _$mergeProps(propsSpread1, propsSpread2, propsSpread3, {
      get ["data-dynamic"]() {
        return color();
      },
      "data-static": color()
    }),
  undefined,
  true
);

// STATIC PROPERTY OF OBJECT ACCESS

// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = {
  style: {
    width: props.width,
    height: props.height
  }
};
var _v$103 = _$ssrHydrationKey();
const template85 = _$ssr(_tmpl$16, _v$103, _$ssrStyle(styleProp.style));
var _v$104 = _$ssrHydrationKey(),
  _v$105 = () => _$ssrStyle(styleProp.style);
const template86 = _$ssr(_tmpl$16, _v$104, _v$105);
const style = {
  background: "red",
  border: "solid black " + count() + "px"
};
var _v$106 = _$ssrHydrationKey(),
  _v$107 = () => _$ssrAttribute("aria-label", _$escape(count(), true)),
  _v$108 = _$scope(() => _$escape(count()));
const template87 = _$ssr(
  _tmpl$46,
  _v$106,
  _v$107,
  _$ssrStyle(style),
  _$ssrClassName(style),
  _v$108
);
var _v$109 = _$ssrHydrationKey(),
  _v$110 = () => _$ssrAttribute("aria-label", _$escape(count(), true)),
  _v$111 = _$scope(() => _$escape(count()));
const template88 = _$ssr(
  _tmpl$46,
  _v$109,
  _v$110,
  _$ssrStyle(style),
  _$ssrClassName(style),
  _v$111
);
var _v$112 = _$ssrHydrationKey();
const template89 = _$ssr(_tmpl$9, _v$112);
var _v$113 = _$ssrHydrationKey(),
  _v$114 = () => _$ssrAttribute("data-test", _$escape(state.flag || undefined, true));
const template90 = _$ssr(_tmpl$47, _v$113, _v$114);
var _v$115 = _$ssrHydrationKey(),
  _v$116 = () => _$ssrAttribute("muted", _$escape(dynamicAttribute(), true));
const template91 = _$ssr(_tmpl$48, _v$115, _v$116);
function MyVideo() {
  var _v$117 = _$ssrHydrationKey();
  return _$ssr(_tmpl$49, _v$117);
}

// #2959: conditional attribute merged into a spread stays a bare expression
// (parity with the dom generate — neither side allocates a hydration id).
const template97 = _$ssrElement(
  "svg",
  () =>
    _$mergeProps(spread, {
      get ["stroke-width"]() {
        return cond() ? width() : 2;
      },
      get fill() {
        return cond() && color();
      }
    }),
  undefined,
  true
);

// solidjs/solid#3015: innerHTML/textContent redirects are opaque content — a
// call-shaped value must not get the _$scope id reservation (the client
// applies these as plain prop effects that never allocate hydration ids), or
// every hydratable sibling after it shifts by one id.
var _v$118 = _$ssrHydrationKey(),
  _v$119 = () => createIcon(props.radius),
  _v$120 = () => _$escape(getLabel(props.id) || " "),
  _v$121 = () => _$ssrAttribute("checked", _$escape(checked(), true));
const template98 = _$ssr(_tmpl$50, _v$118, _v$119, _v$120, _v$121);
