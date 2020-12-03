import { ssrBoolean as _$ssrBoolean } from "r-server";
import { ssrStyle as _$ssrStyle } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { ssrClassList as _$ssrClassList } from "r-server";
import { ssrSpread as _$ssrSpread } from "r-server";
import { getHydrationKey as _$getHydrationKey } from "r-server";

const template = _$ssr(
  [
    '<div data-hk="',
    '" id="main" ',
    ' class="',
    '" style="',
    '"><h1 ',
    ' disabled="" title="',
    '" style="',
    '" class="',
    '"><a href="/">Welcome</a></h1></div>'
  ],
  _$getHydrationKey(),
  _$ssrSpread(results, false, true),
  _$ssrClassList({
    selected: selected
  }),
  "color:" + _$escape(color, true),
  _$ssrSpread(results(), false, true),
  _$escape(welcoming(), true),
  "background-color:" + _$escape(color(), true) + (";margin-right:" + "40px"),
  _$ssrClassList({
    selected: selected()
  })
);

const template2 = _$ssr(
  ['<div data-hk="', '"><div>', "</div><div>", "</div></div>"],
  _$getHydrationKey(),
  _$escape(rowId),
  _$escape(row.label)
);

const template3 = _$ssr(
  ['<div data-hk="', '" id="', '" style="', '" name="', '">', "</div>"],
  _$getHydrationKey(),
  _$escape(state.id, true),
  "background-color:" + _$escape(state.color, true),
  _$escape(state.name, true),
  _$escape(state.content)
);

const template4 = _$ssr(
  ['<div data-hk="', '" class="', '"></div>'],
  _$getHydrationKey(),
  `hi ${_$escape(state.class, true) || ""}`
);

const template5 = _$ssr(['<div data-hk="', '" class="', '"></div>'], _$getHydrationKey(), `a  b`);

const template6 = _$ssr(
  ['<div data-hk="', '" style="', '">Hi</div>'],
  _$getHydrationKey(),
  _$ssrStyle(someStyle())
);

const template7 = _$ssr(
  ['<div data-hk="', '" style="', '"></div>'],
  _$getHydrationKey(),
  _$ssrStyle({
    "background-color": color(),
    "margin-right": "40px",
    ...props.style,
    "padding-top": props.top
  })
);

let refTarget;

const template8 = _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey());

const template9 = _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey());

const template10 = _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey());

const template11 = _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey());

const template12 = _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey());

const template13 = _$ssr(
  ['<input data-hk="', '" type="checkbox"', ">"],
  _$getHydrationKey(),
  _$ssrBoolean(checked, true)
);

const template14 = _$ssr(
  ['<input data-hk="', '" type="checkbox"', ">"],
  _$getHydrationKey(),
  _$ssrBoolean(checked, state.visible)
);
