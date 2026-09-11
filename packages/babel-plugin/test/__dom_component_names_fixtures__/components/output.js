import { template as _$template } from "r-dom";
import { Show as _$Show } from "r-dom";
import { For as _$For } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><!><!><!><!><!><!><!>`);
import { Child, Ui, Row } from "./components";
const Component = () =>
  _$createComponent(
    Child,
    {
      name: "John"
    },
    "Child"
  );
var _el$ = _tmpl$2(),
  _el$3 = _el$.firstChild,
  _el$4 = _el$3.nextSibling,
  _el$5 = _el$4.nextSibling,
  _el$6 = _el$5.nextSibling,
  _el$7 = _el$6.nextSibling,
  _el$8 = _el$7.nextSibling,
  _el$9 = _el$8.nextSibling;
_$insert(
  _el$,
  _$createComponent(
    Child,
    _$mergeProps(
      {
        name: "Jane"
      },
      props,
      {
        get children() {
          var _el$2 = _tmpl$();
          _$insert(_el$2, name);
          return _el$2;
        }
      }
    ),
    "Child"
  ),
  _el$3
);
_$insert(
  _el$,
  _$createComponent(
    Ui.Button,
    {
      variant: "primary"
    },
    "Ui.Button"
  ),
  _el$4
);
_$insert(
  _el$,
  _$createComponent(
    Ui.Layout.Grid,
    {
      cols: 2,
      children: "text"
    },
    "Ui.Layout.Grid"
  ),
  _el$5
);
_$insert(
  _el$,
  _$createComponent(
    _$For,
    {
      get each() {
        return list();
      },
      children: item =>
        _$createComponent(
          Row,
          {
            item: item
          },
          "Row"
        )
    },
    "For"
  ),
  _el$6
);
_$insert(
  _el$,
  _$createComponent(
    _$Show,
    {
      get when() {
        return visible();
      },
      get children() {
        return _$createComponent(Child, {}, "Child");
      }
    },
    "Show"
  ),
  _el$7
);
_$insert(_el$, _$createComponent(_self$.Row, {}, "this.Row"), _el$8);
_$insert(
  _el$,
  _$createComponent(
    Comp,
    {
      children: () => _$createComponent(Child, {}, "Child")
    },
    "Comp"
  ),
  _el$9
);
const template = (() => {
  const _self$ = this;
  return _el$;
})();
class Container {
  render() {
    return _$createComponent(this.Row, {}, "this.Row");
  }
}
