import { createComponent as _$createComponent } from "r-server";
import { ssrSpread as _$ssrSpread } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { getHydrationKey as _$getHydrationKey } from "r-server";

const template = _$ssr(
  [
    '<svg data-hk="',
    '" width="400" height="180"><rect stroke-width="2" x="50" y="20" rx="20" ry="20" width="150" height="150" style="fill:red;stroke:black;stroke-width:5;opacity:0.5"></rect><linearGradient gradientTransform="rotate(25)"><stop offset="0%"></stop></linearGradient></svg>'
  ],
  _$getHydrationKey()
);

const template2 = _$ssr(
  [
    '<svg data-hk="',
    '" width="400" height="180"><rect class="',
    '" stroke-width="',
    '" x="',
    '" y="',
    '" rx="20" ry="20" width="150" height="150" style="',
    '"></rect></svg>'
  ],
  _$getHydrationKey(),
  _$escape(state.name, true),
  _$escape(state.width, true),
  _$escape(state.x, true),
  _$escape(state.y, true),
  "fill:" +
    "red" +
    (";stroke:" + "black") +
    (";stroke-width:" + _$escape(props.stroke, true)) +
    (";opacity:" + 0.5)
);

const template3 = _$ssr(
  ['<svg data-hk="', '" width="400" height="180"><rect ', "></rect></svg>"],
  _$getHydrationKey(),
  _$ssrSpread(props, true, false)
);

const template4 = _$ssr(
  ['<rect data-hk="', '" x="50" y="20" width="150" height="150"></rect>'],
  _$getHydrationKey()
);

const template5 = _$ssr(
  ['<rect data-hk="', '" x="50" y="20" width="150" height="150"></rect>'],
  _$getHydrationKey()
);

const template6 = _$createComponent(Component, {
  get children() {
    return _$ssr(
      ['<rect data-hk="', '" x="50" y="20" width="150" height="150"></rect>'],
      _$getHydrationKey()
    );
  }
});

const template7 = _$ssr(
  [
    '<svg data-hk="',
    '" viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><a xlink:href="',
    '"><text x="10" y="25">MDN Web Docs</text></a></svg>'
  ],
  _$getHydrationKey(),
  _$escape(url, true)
);

const template8 = _$ssr(
  [
    '<svg data-hk="',
    '" viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><text x="10" y="25">',
    "</text></svg>"
  ],
  _$getHydrationKey(),
  _$escape(text)
);
