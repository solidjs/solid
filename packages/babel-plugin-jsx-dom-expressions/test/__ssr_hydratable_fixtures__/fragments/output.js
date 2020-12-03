import { createComponent as _$createComponent } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { getHydrationKey as _$getHydrationKey } from "r-server";
const multiStatic = [
  _$ssr(['<div data-hk="', '">First</div>'], _$getHydrationKey()),
  _$ssr(['<div data-hk="', '">Last</div>'], _$getHydrationKey())
];
const multiExpression = [
  _$ssr(['<div data-hk="', '">First</div>'], _$getHydrationKey()),
  inserted,
  _$ssr(['<div data-hk="', '">Last</div>'], _$getHydrationKey()),
  "After"
];
const multiDynamic = [
  _$ssr(
    ['<div data-hk="', '" id="', '">First</div>'],
    _$getHydrationKey(),
    _$escape(state.first, true)
  ),
  state.inserted,
  _$ssr(
    ['<div data-hk="', '" id="', '">Last</div>'],
    _$getHydrationKey(),
    _$escape(state.last, true)
  ),
  "After"
];
const singleExpression = inserted;
const singleDynamic = inserted();
const firstStatic = [inserted, _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey())];
const firstDynamic = [inserted(), _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey())];
const firstComponent = [
  _$createComponent(Component, {}),
  _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey())
];
const lastStatic = [_$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey()), inserted];
const lastDynamic = [_$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey()), inserted()];
const lastComponent = [
  _$ssr(['<div data-hk="', '"></div>'], _$getHydrationKey()),
  _$createComponent(Component, {})
];
