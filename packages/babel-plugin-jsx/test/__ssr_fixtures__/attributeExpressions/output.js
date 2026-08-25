import { ssrSelectValues as _$ssrSelectValues } from "r-server";
import { memo as _$memo } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyle as _$ssrStyle } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrStyleProperty as _$ssrStyleProperty } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
import { ssr as _$ssr } from "r-server";
var _ref$, _v$, _v$2, _v$20, _v$21, _v$35, _v$36, _v$37, _v$38, _v$39;
var _tmpl$ = ['<a href="/" class="', '">Welcome</a>'],
  _tmpl$2 = ["<div>", "</div>"],
  _tmpl$3 = "<div><div/></div>",
  _tmpl$4 = ["<div foo", ' style="', '"', ">", "</div>"],
  _tmpl$5 = ["<div", ' class="', '"></div>'],
  _tmpl$6 = '<div class="a" className="b"></div>',
  _tmpl$7 = ['<div style="', '">Hi</div>'],
  _tmpl$8 = ['<div style="', '" class="', '"></div>'],
  _tmpl$9 = "<div></div>",
  _tmpl$0 = "<div onclick=\"console.log('hi')\"></div>",
  _tmpl$1 = '<input type="checkbox" checked>',
  _tmpl$10 = ['<input type="checkbox"', ">"],
  _tmpl$11 = '<div class="`a">`$`</div>',
  _tmpl$12 = ['<button class="', '" type="button">Write</button>'],
  _tmpl$13 = ['<button class="', '">Hi</button>'],
  _tmpl$14 = ['<div class="', '"></div>'],
  _tmpl$15 = ["<div><input", "", "", " readonly><input", "", "", "", "></div>"],
  _tmpl$16 = ['<div style="', '"></div>'],
  _tmpl$17 = '<div data="&quot;hi&quot;" data2="&quot;"></div>',
  _tmpl$18 = ["<div", ">", "</div>"],
  _tmpl$19 = ["<div>", "", "</div>"],
  _tmpl$20 =
    '<div class="class1 class2 class3 class4 class5 class6" style="color:red;background-color:blue !important;border:1px solid black;font-size:12px;" random="random1 random2\n    random3 random4"></div>',
  _tmpl$21 = ['<button class="', '"></button>'],
  _tmpl$22 = '<input value="10">',
  _tmpl$23 = ["<select", "><option", ">Red</option><option", ">Blue</option></select>"],
  _tmpl$24 = "<img src>",
  _tmpl$25 = "<div><img src></div>",
  _tmpl$26 = '<img src loading="lazy">',
  _tmpl$27 = '<div><img src loading="lazy"></div>',
  _tmpl$28 = "<iframe src></iframe>",
  _tmpl$29 = "<div><iframe src></iframe></div>",
  _tmpl$30 = '<iframe src loading="lazy"></iframe>',
  _tmpl$31 = '<div><iframe src loading="lazy"></iframe></div>',
  _tmpl$32 = '<div title="&lt;u>data&lt;/u>"></div>',
  _tmpl$33 = '<div true truestr="true" truestrjs="true"></div>',
  _tmpl$34 = '<div falsestr="false" falsestrjs="false"></div>',
  _tmpl$35 = "<div true></div>",
  _tmpl$36 = ['<div a b c d f="0" g h', "", "", " l></div>"],
  _tmpl$37 = '<math display="block"><mrow></mrow></math>',
  _tmpl$38 = "<mrow><mi>x</mi><mo>=</mo></mrow>",
  _tmpl$39 = ["<video", "></video>"],
  _tmpl$40 = "<video playsinline></video>",
  _tmpl$41 = "<video></video>",
  _tmpl$42 = '<video poster="1.jpg"></video>',
  _tmpl$43 = '<div><video poster="1.jpg"></video></div>',
  _tmpl$44 = "<div><video></video></div>",
  _tmpl$45 = ['<div style="', '"', "></div>"],
  _tmpl$46 = ['<button type="button"', ' style="', '" class="', '">', "</button>"],
  _tmpl$47 = ["<style>", "</style>"],
  _tmpl$48 = ['<div class="bg-(--bg)" style="', '"></div>'],
  _tmpl$49 = ["<div", "></div>"],
  _tmpl$50 = ['<div class="progress-fill" style="', '"></div>'],
  _tmpl$51 = [
    "<div><textarea>",
    "</textarea><textarea>",
    "</textarea><textarea>",
    "</textarea><textarea></textarea><textarea>",
    "</textarea><textarea>static content</textarea><textarea>static content</textarea></div>"
  ],
  _tmpl$52 = [
    "<div><video muted></video><video></video><video></video><video muted></video><video",
    '></video><video src="test.mp4" muted></video></div>'
  ];
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
  _$ssrElement(
    "h1",
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
    ((_ref$ = link), _$ssr(_tmpl$, "ccc ddd")),
    false
  ),
  false
);
const template2 = _$ssrElement(
  "div",
  getProps("test"),
  [
    ((_v$ = _$escape(rowId)), _$ssr(_tmpl$2, _v$)),
    ((_v$2 = () => _$escape(row.label)), _$ssr(_tmpl$2, _v$2)),
    _$ssr(_tmpl$3)
  ],
  false
);
var _g$ = _$ssrGroup(
  () => [_$ssrAttribute("name", _$escape(state.name, true)), _$escape(/*@static*/ state.content)],
  2
);
const template3 = _$ssr(
  _tmpl$4,
  _$ssrAttribute("id", _$escape(state.id, true)),
  _$ssrStyleProperty("background-color:", _$escape(state.color, true)),
  _g$,
  _g$
);
var _v$5 = () => _$ssrAttribute("className", _$escape(state.class, true));
const template4 = _$ssr(_tmpl$5, _v$5, "ccc:ddd");
const template5 = _$ssr(_tmpl$6);
var _v$6 = () => _$ssrStyle(someStyle());
const template6 = _$ssr(_tmpl$7, _v$6);
let undefVar;
var _v$7 = () =>
  _$ssrStyle({
    "background-color": color(),
    "margin-right": "40px",
    ...props.style
  });
const template7 = _$ssr(_tmpl$8, _v$7, undefVar ? "other-class2" : "");
let refTarget;
var _ref$2 = refTarget;
const template8 = _$ssr(_tmpl$9);
var _ref$3 = e => console.log(e);
const template9 = _$ssr(_tmpl$9);
var _ref$4 = refFactory();
const template10 = _$ssr(_tmpl$9);
const template12 = _$ssr(_tmpl$0);
const template13 = _$ssr(_tmpl$1);
var _v$8 = () => _$ssrAttribute("checked", _$escape(state.visible, true));
const template14 = _$ssr(_tmpl$10, _v$8);
const template15 = _$ssr(_tmpl$11);
const template16 = _$ssr(
  _tmpl$12,
  _$ssrClassName([
    "static",
    {
      hi: "k"
    }
  ])
);
const template17 = _$ssr(_tmpl$13, "a  b  c");
const template18 = _$ssrElement(
  "div",
  {
    get [key()]() {
      return props.value;
    }
  },
  undefined,
  false
);
const template19 = _$ssr(
  _tmpl$14,
  _$ssrClassName([
    {
      "bg-red-500": true
    },
    "flex flex-col"
  ])
);
var _g$3 = _$ssrGroup(
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
  _v$9 = () => _$ssrAttribute("value", _$escape(s(), true)),
  _v$10 = () => _$ssrAttribute("checked", _$escape(s2(), true));
const template20 = _$ssr(
  _tmpl$15,
  _v$9,
  _g$3,
  _g$3,
  _v$10,
  _g$2,
  _g$2,
  _$ssrAttribute("readonly", _$escape(value, true))
);
var _v$13 = () =>
  _$ssrStyle({
    a: "static",
    ...rest
  });
const template21 = _$ssr(_tmpl$16, _v$13);
const template22 = _$ssr(_tmpl$17);
var _v$14 = () => _$ssrAttribute("disabled", "t" in _$escape(test, true)),
  _v$15 = () => "t" in test && "true";
const template23 = _$ssr(_tmpl$18, _v$14, _v$15);
const template24 = _$ssrElement(
  "a",
  _$mergeProps(props, {
    something: true
  }),
  undefined,
  false
);
var _v$16 = () => _$escape(props.children),
  _v$17 = _$ssrElement(
    "a",
    _$mergeProps(props, {
      something: true
    }),
    undefined,
    false
  );
const template25 = _$ssr(_tmpl$19, _v$16, _v$17);
const template26 = _$ssrElement(
  "div",
  _$mergeProps(
    {
      start: "Hi",
      middle: middle
    },
    spread
  ),
  "Hi",
  false
);
const template27 = _$ssrElement(
  "div",
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
  "Hi",
  false
);
const template28 = _$ssrElement(
  "label",
  api(),
  [
    _$ssrElement("span", api(), ["Input is ", () => (api() ? "checked" : "unchecked")], false),
    _$ssrElement("input", api(), undefined, false),
    _$ssrElement("div", api(), undefined, false)
  ],
  false
);
var _v$18 = !!someValue;
const template29 = _$ssr(_tmpl$18, _$ssrAttribute("attribute", !!someValue), _v$18);
const template30 = _$ssr(_tmpl$20);
var _v$19 = () =>
  _$ssrStyleProperty("background-color:", _$escape(getStore.itemProperties.color, true));
const template31 = _$ssr(_tmpl$16, _v$19);
const template32 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("background-color:", _$escape(undefined, true))
);
const template33 = [
  _$ssr(_tmpl$21, _$ssrClassName(styles.button)),
  _$ssr(_tmpl$21, _$ssrClassName(styles["foo--bar"])),
  ((_v$20 = () => _$ssrClassName(styles.foo.bar)), _$ssr(_tmpl$21, _v$20)),
  ((_v$21 = () => _$ssrClassName(styles[foo()])), _$ssr(_tmpl$21, _v$21))
];
var _ref$5 = a().b.c;
const template35 = _$ssr(_tmpl$9);
var _ref$6 = a().b?.c;
const template36 = _$ssr(_tmpl$9);
var _ref$7 = a() ? b : c;
const template37 = _$ssr(_tmpl$9);
var _ref$8 = a() ?? b;
const template38 = _$ssr(_tmpl$9);
const template39 = _$ssr(_tmpl$22);
var _v$22 = () => _$ssrStyleProperty("color:", _$escape(a(), true));
const template40 = _$ssr(_tmpl$16, _v$22);
var _v$23 = () => _$ssrAttribute("value", _$escape(state.color, true)),
  _v$24 = () => _$ssrAttribute("value", _$escape(Color.Red, true)),
  _v$25 = () => _$ssrAttribute("value", _$escape(Color.Blue, true));
const template41 = _$ssr(_tmpl$23, _v$23, _v$24, _v$25);
const template42 = _$ssr(_tmpl$24);
const template43 = _$ssr(_tmpl$25);
const template44 = _$ssr(_tmpl$26);
const template45 = _$ssr(_tmpl$27);
const template46 = _$ssr(_tmpl$28);
const template47 = _$ssr(_tmpl$29);
const template48 = _$ssr(_tmpl$30);
const template49 = _$ssr(_tmpl$31);
const template50 = _$ssr(_tmpl$32);
var _ref$9 = binding;
const template51 = _$ssr(_tmpl$9);
var _ref$0 = binding.prop;
const template52 = _$ssr(_tmpl$9);
var _ref$1 = refFn;
const template53 = _$ssr(_tmpl$9);
var _ref$10 = refConst;
const template54 = _$ssr(_tmpl$9);
var _ref$11 = refUnknown;
const template55 = _$ssr(_tmpl$9);
const template56 = _$ssr(_tmpl$33);
const template57 = _$ssr(_tmpl$34);
const template58 = _$ssr(_tmpl$9);
const template59 = _$ssr(_tmpl$35);
const template60 = _$ssr(
  _tmpl$36,
  _$ssrAttribute("i", _$escape(undefined, true)),
  _$ssrAttribute("j", _$escape(null, true)),
  _$ssrAttribute("k", void 0)
);
const template61 = _$ssr(_tmpl$37);
const template62 = _$ssr(_tmpl$38);
const template63 = _$ssr(_tmpl$16, _$ssrStyleProperty("background:", "red"));
const template64 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";margin:", 3) +
    _$ssrStyleProperty(";padding:", 0.4)
);
const template65 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(undefined, true))
);
var _v$26 = () =>
  _$ssrStyleProperty("background:", "red") +
  _$ssrStyleProperty(";color:", "green") +
  _$ssrStyleProperty(";border:", _$escape(signal(), true));
const template66 = _$ssr(_tmpl$16, _v$26);
const template67 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(somevalue, true))
);
var _v$27 = () =>
  _$ssrStyleProperty("background:", "red") +
  _$ssrStyleProperty(";color:", "green") +
  _$ssrStyleProperty(";border:", _$escape(some.access, true));
const template68 = _$ssr(_tmpl$16, _v$27);
const template69 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("background:", "red") +
    _$ssrStyleProperty(";color:", "green") +
    _$ssrStyleProperty(";border:", _$escape(null, true))
);
const template70 = _$ssr(_tmpl$39, _$ssrAttribute("playsinline", _$escape(value, true)));
const template71 = _$ssr(_tmpl$40);
const template72 = _$ssr(_tmpl$41);
const template73 = _$ssr(_tmpl$42);
const template74 = _$ssr(_tmpl$43);
const template75 = _$ssr(_tmpl$41);
const template76 = _$ssr(_tmpl$44);

// STATIC TESTS

const template77 = _$ssr(
  _tmpl$16,
  _$ssrStyleProperty("width:", _$escape(props.width, true)) +
    _$ssrStyleProperty(";height:", _$escape(props.height, true))
);
var _v$28 = () => _$ssrAttribute("something", _$escape(color(), true));
const template78 = _$ssr(
  _tmpl$45,
  _$ssrStyleProperty("width:", _$escape(props.width, true)) +
    _$ssrStyleProperty(";height:", _$escape(props.height, true)),
  _v$28
);
var _v$29 = () =>
  _$ssrStyleProperty("width:", _$escape(props.width, true)) +
  _$ssrStyleProperty(";height:", _$escape(/* @static */ props.height, true));
const template79 = _$ssr(_tmpl$45, _v$29, _$ssrAttribute("something", _$escape(color(), true)));

// STATIC TESTS SPREADS

const propsSpread = {
  something: color(),
  style: {
    "background-color": color(),
    color: /* @static*/ color(),
    "margin-right": /* @static */ props.right
  }
};
const template80 = _$ssrElement("div", propsSpread, undefined, false);
const template81 = _$ssrElement("div", propsSpread, undefined, false);
const template82 = _$ssrElement(
  "div",
  _$mergeProps(propsSpread, {
    get ["data-dynamic"]() {
      return color();
    },
    "data-static": color()
  }),
  undefined,
  false
);
const template83 = _$ssrElement(
  "div",
  _$mergeProps(propsSpread, {
    get ["data-dynamic"]() {
      return color();
    },
    "data-static": color()
  }),
  undefined,
  false
);
const template84 = _$ssrElement(
  "div",
  _$mergeProps(propsSpread1, propsSpread2, propsSpread3, {
    get ["data-dynamic"]() {
      return color();
    },
    "data-static": color()
  }),
  undefined,
  false
);

// STATIC PROPERTY OF OBJECT ACCESS

// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = {
  style: {
    width: props.width,
    height: props.height
  }
};
const template85 = _$ssr(_tmpl$16, _$ssrStyle(styleProp.style));
var _v$30 = () => _$ssrStyle(styleProp.style);
const template86 = _$ssr(_tmpl$16, _v$30);
const style = {
  background: "red",
  border: "solid black " + count() + "px"
};
var _v$31 = () => _$ssrAttribute("aria-label", _$escape(count(), true)),
  _v$32 = () => _$escape(count());
const template87 = _$ssr(_tmpl$46, _v$31, _$ssrStyle(style), _$ssrClassName(style), _v$32);
var _v$33 = () => _$ssrAttribute("aria-label", _$escape(count(), true)),
  _v$34 = () => _$escape(count());
const template88 = _$ssr(_tmpl$46, _v$33, _$ssrStyle(style), _$ssrClassName(style), _v$34);
const css = () => "&{color:red}";
const template89 = [
  ((_v$35 = () => css()), _$ssr(_tmpl$47, _v$35)),
  ((_v$36 = () => css()), _$ssr(_tmpl$47, _v$36)),
  ((_v$37 = () => css()), _$ssr(_tmpl$47, _v$37)),
  ((_v$38 = () => css()), _$ssr(_tmpl$47, _v$38)),
  ((_v$39 = () => css()), _$ssr(_tmpl$47, _v$39))
];
const styleProps = {
  children: css
};
const template90 = [
  _$ssrElement("style", styleProps(), () => css(), false),
  _$ssrElement(
    "style",
    _$mergeProps(styleProps, {
      get children() {
        return css();
      }
    }),
    undefined,
    false
  ),
  _$ssrElement(
    "style",
    _$mergeProps(styleProps, {
      get innerHTML() {
        return css();
      }
    }),
    undefined,
    false
  ),
  _$ssrElement(
    "style",
    _$mergeProps(styleProps, {
      get innerText() {
        return css();
      }
    }),
    undefined,
    false
  ),
  _$ssrElement(
    "style",
    _$mergeProps(styleProps, {
      get textContent() {
        return css();
      }
    }),
    undefined,
    false
  )
];
const nope = () => undefined;
var _v$40 = () => _$ssrStyleProperty("--bg:", _$escape(nope(), true));
const template91 = _$ssr(_tmpl$48, _v$40);
const template92 = _$ssr(_tmpl$9);
var _v$41 = () => _$ssrAttribute("data-test", _$escape(state.flag || undefined, true));
const template93 = _$ssr(_tmpl$49, _v$41);
function Progress(props) {
  var _v$42 = () =>
    _$ssrStyleProperty(
      _$escape(props.orientation === "y" ? "height" : "width", true) + ":",
      `${_$escape(props.value, true) * 100}%`
    );
  return _$ssr(_tmpl$50, _v$42);
}
var _v$43 = () => _$escape(dynamicProperty()),
  _v$44 = () => _$escape(dynamicProperty()),
  _v$45 = () => _$escape(dynamicContent()),
  _v$46 = () => _$escape(dynamicContent());
const template94 = _$ssr(_tmpl$51, _v$43, _v$44, _v$45, _v$46);
var _v$47 = () => _$ssrAttribute("muted", _$escape(dynamicAttribute(), true));
const template95 = _$ssr(_tmpl$52, _v$47);
