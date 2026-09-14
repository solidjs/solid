import { Show as _$Show } from "r-dom";
import { For as _$For } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { ssr as _$ssr } from "r-dom";
import { escape as _$escape } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _v$;
var _tmpl$ = ["<span>", "</span>"],
  _tmpl$2 = ["<div>", "", "", "", "", "", "", "</div>"];
import { Child, Ui, Row } from "./components";
const Component = () =>
  _$createComponent(
    Child,
    {
      name: "John"
    },
    "Child"
  );
var _v$2 = _$escape(
    _$createComponent(
      Child,
      _$mergeProps(
        {
          name: "Jane"
        },
        props,
        {
          get children() {
            return ((_v$ = () => _$escape(name())), _$ssr(_tmpl$, _v$));
          }
        }
      ),
      "Child"
    )
  ),
  _v$3 = _$escape(
    _$createComponent(
      Ui.Button,
      {
        variant: "primary"
      },
      "Ui.Button"
    )
  ),
  _v$4 = _$escape(
    _$createComponent(
      Ui.Layout.Grid,
      {
        cols: 2,
        children: "text"
      },
      "Ui.Layout.Grid"
    )
  ),
  _v$5 = _$escape(
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
    )
  ),
  _v$6 = _$escape(
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
    )
  ),
  _v$7 = _$escape(_$createComponent(_self$.Row, {}, "this.Row")),
  _v$8 = _$escape(
    _$createComponent(
      Comp,
      {
        children: () => _$createComponent(Child, {}, "Child")
      },
      "Comp"
    )
  );
const template = (() => {
  const _self$ = this;
  return _$ssr(_tmpl$2, _v$2, _v$3, _v$4, _v$5, _v$6, _v$7, _v$8);
})();
class Container {
  render() {
    return _$createComponent(this.Row, {}, "this.Row");
  }
}
