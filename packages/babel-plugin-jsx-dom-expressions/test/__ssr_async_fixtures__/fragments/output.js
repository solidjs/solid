import { createComponent as _$createComponent } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
const multiStatic = [_$ssr("<div>First</div>"), _$ssr("<div>Last</div>")];
const multiExpression = [_$ssr("<div>First</div>"), inserted, _$ssr("<div>Last</div>"), "After"];
const multiDynamic = [
  _$ssr(['<div id="', '">First</div>'], () => _$escape(state.first, true)),
  () => state.inserted,
  _$ssr(['<div id="', '">Last</div>'], () => _$escape(state.last, true)),
  "After"
];
const singleExpression = inserted;
const singleDynamic = inserted;
const firstStatic = [inserted, _$ssr("<div></div>")];
const firstDynamic = [inserted, _$ssr("<div></div>")];
const firstComponent = [_$createComponent(Component, {}), _$ssr("<div></div>")];
const lastStatic = [_$ssr("<div></div>"), inserted];
const lastDynamic = [_$ssr("<div></div>"), inserted];
const lastComponent = [_$ssr("<div></div>"), _$createComponent(Component, {})];
