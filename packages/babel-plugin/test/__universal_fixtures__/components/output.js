import { memo as _$memo } from "r-custom";
import { For as _$For } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { mergeProps as _$mergeProps } from "r-custom";
import { applyRef as _$applyRef } from "r-custom";
import { insert as _$insert } from "r-custom";
import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { ref as _$ref } from "r-custom";
import { Show, binding } from "somewhere";
function refFn() {}
const refConst = null;
const Child = props => [
  (() => {
    var _el$ = _$createElement("div"),
      _el$2 = _$createTextNode(`Hello `);
    _$insertNode(_el$, _el$2);
    var _ref$ = props.ref;
    typeof _ref$ === "function" || Array.isArray(_ref$)
      ? _$ref(() => _ref$, _el$)
      : (props.ref = _el$);
    _$insert(_el$, () => props.name, null);
    return _el$;
  })(),
  (() => {
    var _el$3 = _$createElement("div");
    _$insert(_el$3, () => props.children);
    return _el$3;
  })()
];
const template = props => {
  let childRef;
  const { content } = props;
  var _el$4 = _$createElement("div");
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
            var _el$5 = _$createElement("div");
            _$insertNode(_el$5, _$createTextNode(`From Parent`));
            return _el$5;
          }
        }
      )
    ),
    null
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
            var _el$7 = _$createElement("div");
            _$insert(_el$7, content);
            return _el$7;
          }
        }
      )
    ),
    null
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
    null
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
    return [_$createElement("div"), _$createElement("div"), _$createElement("div"), "After"];
  }
});
const template4 = _$createComponent(Child, {
  get children() {
    return _$createElement("div");
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
    return [_$createElement("div"), _$memo(() => state.dynamic)];
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
var _el$11 = _$createElement("div"),
  _el$12 = _$createTextNode(` | `),
  _el$13 = _$createTextNode(` | `),
  _el$14 = _$createTextNode(` | `),
  _el$15 = _$createTextNode(` | `),
  _el$16 = _$createTextNode(` | `);
_$insertNode(_el$11, _el$12);
_$insertNode(_el$11, _el$13);
_$insertNode(_el$11, _el$14);
_$insertNode(_el$11, _el$15);
_$insertNode(_el$11, _el$16);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$12
);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$13
);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$14
);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$15
);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$16
);
_$insert(
  _el$11,
  _$createComponent(Link, {
    children: "submit"
  }),
  null
);
const template10 = _el$11;
var _el$17 = _$createElement("div"),
  _el$18 = _$createTextNode(` | `),
  _el$19 = _$createTextNode(` | `),
  _el$20 = _$createTextNode(` | `);
_$insertNode(_el$17, _el$18);
_$insertNode(_el$17, _el$19);
_$insertNode(_el$17, _el$20);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$18
);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$19
);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$19
);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$20
);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$20
);
_$insert(
  _el$17,
  _$createComponent(Link, {
    children: "submit"
  }),
  null
);
const template11 = _el$17;
var _el$21 = _$createElement("div"),
  _el$22 = _$createTextNode(` | `),
  _el$23 = _$createTextNode(` |  |  | `),
  _el$26 = _$createTextNode(` | `);
_$insertNode(_el$21, _el$22);
_$insertNode(_el$21, _el$23);
_$insertNode(_el$21, _el$26);
_$insert(
  _el$21,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$23
);
_$insert(
  _el$21,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$26
);
const template12 = _el$21;
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
    return [
      (() => {
        var _el$27 = _$createElement("span");
        _$insertNode(_el$27, _$createTextNode(`1`));
        return _el$27;
      })(),
      " ",
      (() => {
        var _el$29 = _$createElement("span");
        _$insertNode(_el$29, _$createTextNode(`2`));
        return _el$29;
      })(),
      " ",
      (() => {
        var _el$31 = _$createElement("span");
        _$insertNode(_el$31, _$createTextNode(`3`));
        return _el$31;
      })()
    ];
  }
});
const Template18 = _$createComponent(Pre, {
  get children() {
    return [
      (() => {
        var _el$33 = _$createElement("span");
        _$insertNode(_el$33, _$createTextNode(`1`));
        return _el$33;
      })(),
      (() => {
        var _el$35 = _$createElement("span");
        _$insertNode(_el$35, _$createTextNode(`2`));
        return _el$35;
      })(),
      (() => {
        var _el$37 = _$createElement("span");
        _$insertNode(_el$37, _$createTextNode(`3`));
        return _el$37;
      })()
    ];
  }
});
const Template19 = _$createComponent(
  Component,
  _$mergeProps(() => s.dynamic())
);
const Template20 = _$createComponent(Component, {
  get ["class"]() {
    return prop.red ? "red" : "green";
  }
});
const template21 = _$createComponent(
  Component,
  _$mergeProps(() => ({
    get [key()]() {
      return props.value;
    }
  }))
);
const template22 = _$createComponent(Component, {
  get passObject() {
    return {
      ...a
    };
  }
});
const template23 = _$createComponent(Component, {
  ref: binding
});
const template24 = _$createComponent(Component, {
  ref(r$) {
    var _ref$5 = binding.prop;
    typeof _ref$5 === "function" || Array.isArray(_ref$5)
      ? _$applyRef(_ref$5, r$)
      : (binding.prop = r$);
  }
});
const template25 = _$createComponent(Component, {
  ref(r$) {
    var _ref$6 = refFn;
    typeof _ref$6 === "function" || Array.isArray(_ref$6) ? _$applyRef(_ref$6, r$) : (refFn = r$);
  }
});
const template26 = _$createComponent(Component, {
  ref: refConst
});
const template27 = _$createComponent(Component, {
  ref(r$) {
    var _ref$7 = refUnknown;
    typeof _ref$7 === "function" || Array.isArray(_ref$7)
      ? _$applyRef(_ref$7, r$)
      : (refUnknown = r$);
  }
});
const template28 = _$createComponent(Component, {
  ref(r$) {
    var _ref$8 = binding?.prop;
    typeof _ref$8 === "function" || Array.isArray(_ref$8)
      ? _$applyRef(_ref$8, r$)
      : !!binding && (binding.prop = r$);
  }
});
const template29 = _$createComponent(Component, {});
const template30 = _$createComponent(Component, {});
