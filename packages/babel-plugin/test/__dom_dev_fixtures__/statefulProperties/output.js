import { template as _$template } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setProperty as _$setProperty } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { setStatefulProperty as _$setStatefulProperty } from "r-dom";
import { className as _$className } from "r-dom";
import { readShallow as _$readShallow } from "r-dom";
import { effect as _$effect } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<input>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<input type=checkbox>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<textarea>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<video>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<select><option>`);
var _el$ = _tmpl$();
_$addEvent(_el$, "change", commit);
_$effect(
  () => ({
    e: _$readShallow(cls()),
    t: props.name
  }),
  ({ e, t }, _p$) => {
    _$className(_el$, e, _p$?.e);
    _$setStatefulProperty(_el$, "value", t ?? "");
  },
  {
    name: "input.class, input.value",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:5:24"
  }
);
// Stateful DOM properties in dev DOM output (#4186): every write goes
// through `setStatefulProperty` so the dev runtime can report an
// uncommitted edit being overwritten. Production output inlines the same
// writes as assignments.
const grouped = _el$;
var _el$2 = _tmpl$();
_$effect(
  () => text(),
  _v$ => {
    _$setStatefulProperty(_el$2, "value", _v$ ?? "");
  },
  {
    name: "input.value",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:7:21"
  }
);
const lone = _el$2;
var _el$3 = _tmpl$2();
_$effect(
  () => ({
    e: on(),
    t: title()
  }),
  ({ e, t }, _p$) => {
    _$setStatefulProperty(_el$3, "checked", e);
    t !== _p$?.t && _$setAttribute(_el$3, "title", t);
  },
  {
    name: "input.checked, input.title",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:9:40"
  }
);
const checked = _el$3;
var _el$4 = _tmpl$2();
_$effect(
  () => choice(),
  _v$ => {
    _$setProperty(_el$4, "value", _v$);
  },
  {
    name: "input.value",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:11:47"
  }
);
const checkableValue = _el$4;
var _el$5 = _tmpl$3();
_$effect(
  () => text(),
  _v$ => {
    _$setStatefulProperty(_el$5, "value", _v$ ?? "");
  },
  {
    name: "textarea.value",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:13:28"
  }
);
const textarea = _el$5;
var _el$6 = _tmpl$4();
_$effect(
  () => muted(),
  _v$ => {
    _$setStatefulProperty(_el$6, "muted", _v$);
  },
  {
    name: "video.muted",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:15:22"
  }
);
const media = _el$6;
var _el$7 = _tmpl$5(),
  _el$8 = _el$7.firstChild;
_$effect(
  () => ({
    e: picked(),
    t: first(),
    a: isFirst()
  }),
  ({ e, t, a }, _p$) => {
    _$setProperty(_el$7, "value", e);
    _$setStatefulProperty(_el$8, "value", t);
    _$setStatefulProperty(_el$8, "selected", a);
  },
  {
    name: "select.value, option.value, option.selected",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:18:11"
  }
);
const select = _el$7;
var _el$9 = _tmpl$();
_$effect(
  () => text(),
  _v$ => {
    _$setStatefulProperty(_el$9, "value", _v$ ?? "");
  },
  {
    name: "input.value",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:23:29"
  }
);
const explicitProp = _el$9;
var _el$0 = _tmpl$();
_$effect(
  () => ({
    e: text(),
    t: on()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && (_el$0.defaultValue = e ?? "");
    t !== _p$?.t && (_el$0.defaultChecked = t);
  },
  {
    name: "input.defaultValue, input.defaultChecked",
    loc: "test/__dom_dev_fixtures__/statefulProperties/code.js:25:25"
  }
);
const defaults = _el$0;
var _el$1 = _tmpl$();
_$setStatefulProperty(_el$1, "value", initial ?? "");
const once = _el$1;
var _el$10 = _tmpl$();
_$spread(
  _el$10,
  [
    rest,
    {
      get value() {
        return text();
      }
    }
  ],
  false,
  undefined,
  "input",
  "test/__dom_dev_fixtures__/statefulProperties/code.js:29:28"
);
const spreadInput = _el$10;
