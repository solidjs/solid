import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { memo as _$memo } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";

const _tmpl$ = _$template(`<div>First</div>`, 2),
  _tmpl$2 = _$template(`<div>Last</div>`, 2),
  _tmpl$3 = _$template(`<div></div>`, 2);

const multiStatic = [_$getNextElement(_tmpl$), _$getNextElement(_tmpl$2)];
const multiExpression = [_$getNextElement(_tmpl$), inserted, _$getNextElement(_tmpl$2), "After"];
const multiDynamic = [
  (() => {
    const _el$5 = _$getNextElement(_tmpl$);

    _$effect(() => _$setAttribute(_el$5, "id", state.first));

    return _el$5;
  })(),
  _$memo(() => state.inserted),
  (() => {
    const _el$6 = _$getNextElement(_tmpl$2);

    _$effect(() => _$setAttribute(_el$6, "id", state.last));

    return _el$6;
  })(),
  "After"
];
const singleExpression = inserted;
const singleDynamic = inserted;
const firstStatic = [inserted, _$getNextElement(_tmpl$3)];
const firstDynamic = [_$memo(inserted), _$getNextElement(_tmpl$3)];
const firstComponent = [_$createComponent(Component, {}), _$getNextElement(_tmpl$3)];
const lastStatic = [_$getNextElement(_tmpl$3), inserted];
const lastDynamic = [_$getNextElement(_tmpl$3), _$memo(inserted)];
const lastComponent = [_$getNextElement(_tmpl$3), _$createComponent(Component, {})];
