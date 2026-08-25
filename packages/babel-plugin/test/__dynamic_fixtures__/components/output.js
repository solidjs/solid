import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-custom";
import { For as _$For } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { mergeProps as _$mergeProps } from "r-custom";
import { applyRef as _$applyRef } from "r-custom";
import { insert as _$insert } from "r-dom";
import { ref as _$ref } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>Hello `),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div>From Parent`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><!><!><!>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div> | <!> | <!> | <!> | <!> | <!>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div> | <!><!> | <!><!> | <!>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<div> | <!> |  |  | <!> | `),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span>1`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<span>2`),
  _tmpl$0 = /*#__PURE__*/ _$template(`<span>3`);
import { Show } from "somewhere";
const Child = props => {
  const [s, set] = createSignal();
  return [
    (() => {
      var _el$ = _tmpl$(),
        _el$2 = _el$.firstChild;
      var _ref$ = props.ref;
      typeof _ref$ === "function" || Array.isArray(_ref$)
        ? _$ref(() => _ref$, _el$)
        : (props.ref = _el$);
      _$insert(_el$, () => props.name, null);
      return _el$;
    })(),
    (() => {
      var _el$3 = _tmpl$2();
      _$ref(() => set, _el$3);
      _$insert(_el$3, () => props.children);
      return _el$3;
    })()
  ];
};
const template = props => {
  let childRef;
  const { content } = props;
  var _el$4 = _tmpl$4(),
    _el$7 = _el$4.firstChild,
    _el$8 = _el$7.nextSibling,
    _el$9 = _el$8.nextSibling;
  _$insert(
    _el$4,
    _$createComponent(
      Child,
      _$mergeProps(
        {
          name: "John"
        },
        props,
        {
          ref(r$) {
            var _ref$2 = childRef;
            typeof _ref$2 === "function" || Array.isArray(_ref$2)
              ? _$applyRef(_ref$2, r$)
              : (childRef = r$);
          },
          booleanProperty: true,
          get children() {
            return _tmpl$3();
          }
        }
      )
    ),
    _el$7
  );
  _$insert(
    _el$4,
    _$createComponent(
      Child,
      _$mergeProps(
        {
          name: "Jason"
        },
        dynamicSpread,
        {
          ref(r$) {
            var _ref$3 = props.ref;
            typeof _ref$3 === "function" || Array.isArray(_ref$3)
              ? _$applyRef(_ref$3, r$)
              : (props.ref = r$);
          },
          get children() {
            var _el$6 = _tmpl$2();
            _$insert(_el$6, content);
            return _el$6;
          }
        }
      )
    ),
    _el$8
  );
  _$insert(
    _el$4,
    (() => {
      var _ref$4 = props.consumerRef();
      return _$createComponent(Context.Consumer, {
        ref(r$) {
          (typeof _ref$4 === "function" || Array.isArray(_ref$4)) && _$applyRef(_ref$4, r$);
        },
        children: context => context
      });
    })(),
    _el$9
  );
  return _el$4;
};
const template2 = _$createComponent(Child, {
  name: "Jake",
  get dynamic() {
    return state.data;
  },
  stale: state.data,
  handleClick: clickHandler,
  get ["hyphen-ated"]() {
    return state.data;
  },
  ref: el => (e = el)
});
const template3 = _$createComponent(Child, {
  get children() {
    return [_tmpl$2(), _tmpl$2(), _tmpl$2(), "After"];
  }
});
const [s, set] = createSignal();
const template4 = _$createComponent(Child, {
  ref: set,
  get children() {
    return _tmpl$2();
  }
});
const template5 = _$createComponent(Child, {
  get dynamic() {
    return state.dynamic;
  },
  get children() {
    return state.dynamic;
  }
});

// builtIns
const template6 = _$createComponent(_$For, {
  get each() {
    return state.list;
  },
  get fallback() {
    return _$createComponent(Loading, {});
  },
  children: item =>
    _$createComponent(Show, {
      get when() {
        return state.condition;
      },
      children: item
    })
});
const template7 = _$createComponent(Child, {
  get children() {
    return [_tmpl$2(), _$memo(() => state.dynamic)];
  }
});
const template8 = _$createComponent(Child, {
  get children() {
    return [item => item, item => item];
  }
});
const template9 = _$createComponent(_garbage, {
  children: "Hi"
});
var _el$13 = _tmpl$5(),
  _el$14 = _el$13.firstChild,
  _el$19 = _el$14.nextSibling,
  _el$15 = _el$19.nextSibling,
  _el$20 = _el$15.nextSibling,
  _el$16 = _el$20.nextSibling,
  _el$21 = _el$16.nextSibling,
  _el$17 = _el$21.nextSibling,
  _el$22 = _el$17.nextSibling,
  _el$18 = _el$22.nextSibling,
  _el$23 = _el$18.nextSibling;
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$14
);
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$19
);
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$20
);
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$21
);
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$22
);
_$insert(
  _el$13,
  _$createComponent(Link, {
    children: "submit"
  }),
  _el$23
);
const template10 = _el$13;
var _el$24 = _tmpl$6(),
  _el$25 = _el$24.firstChild,
  _el$28 = _el$25.nextSibling,
  _el$29 = _el$28.nextSibling,
  _el$26 = _el$29.nextSibling,
  _el$30 = _el$26.nextSibling,
  _el$31 = _el$30.nextSibling,
  _el$27 = _el$31.nextSibling,
  _el$32 = _el$27.nextSibling;
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$25
);
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$28
);
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$29
);
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$30
);
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$31
);
_$insert(
  _el$24,
  _$createComponent(Link, {
    children: "submit"
  }),
  _el$32
);
const template11 = _el$24;
var _el$33 = _tmpl$7(),
  _el$34 = _el$33.firstChild,
  _el$39 = _el$34.nextSibling,
  _el$35 = _el$39.nextSibling,
  _el$40 = _el$35.nextSibling,
  _el$38 = _el$40.nextSibling;
_$insert(
  _el$33,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$39
);
_$insert(
  _el$33,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$40
);
const template12 = _el$33;
class Template13 {
  render() {
    const _self$ = this;
    _$createComponent(Component, {
      get prop() {
        return _self$.something;
      },
      onClick: () => _self$.shouldStay,
      get children() {
        return _$createComponent(Nested, {
          get prop() {
            return _self$.data;
          },
          get children() {
            return _self$.content;
          }
        });
      }
    });
  }
}
const Template14 = _$createComponent(Component, {
  get children() {
    return data();
  }
});
const Template15 = _$createComponent(Component, props);
const Template16 = _$createComponent(
  Component,
  _$mergeProps(
    {
      something: something
    },
    props
  )
);
const Template17 = _$createComponent(Pre, {
  get children() {
    return [_tmpl$8(), " ", _tmpl$9(), " ", _tmpl$0()];
  }
});
const Template18 = _$createComponent(Pre, {
  get children() {
    return [_tmpl$8(), _tmpl$9(), _tmpl$0()];
  }
});
const Template19 = _$createComponent(
  Component,
  _$mergeProps(() => s.dynamic())
);
