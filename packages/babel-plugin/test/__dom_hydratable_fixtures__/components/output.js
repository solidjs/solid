import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-dom";
import { For as _$For } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { applyRef as _$applyRef } from "r-dom";
import { scope as _$scope } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { ref as _$ref } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>Hello <!$><!/>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div>From Parent`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><!$><!/><!$><!/><!$><!/>`),
  _tmpl$5 = /*#__PURE__*/ _$template(
    `<div><!$><!/> | <!$><!/> | <!$><!/> | <!$><!/> | <!$><!/> | <!$><!/>`
  ),
  _tmpl$6 = /*#__PURE__*/ _$template(
    `<div><!$><!/> | <!$><!/><!$><!/> | <!$><!/><!$><!/> | <!$><!/>`
  ),
  _tmpl$7 = /*#__PURE__*/ _$template(`<div> | <!$><!/> |  |  | <!$><!/> | `),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span>1`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<span>2`),
  _tmpl$0 = /*#__PURE__*/ _$template(`<span>3`);
import { Show } from "somewhere";
const Child = props => {
  const [s, set] = createSignal();
  return [
    (() => {
      var _el$ = _$getNextElement(_tmpl$),
        _el$2 = _el$.firstChild,
        _el$3 = _el$2.nextSibling,
        [_el$4, _co$] = _$getNextMarker(_el$3.nextSibling);
      var _ref$ = props.ref;
      typeof _ref$ === "function" || Array.isArray(_ref$)
        ? _$ref(() => _ref$, _el$)
        : (props.ref = _el$);
      _$insert(_el$, () => props.name, _el$4, _co$);
      return _el$;
    })(),
    (() => {
      var _el$5 = _$getNextElement(_tmpl$2);
      _$ref(() => set, _el$5);
      _$insert(
        _el$5,
        _$scope(() => props.children)
      );
      return _el$5;
    })()
  ];
};
const template = props => {
  let childRef;
  const { content } = props;
  var _el$6 = _$getNextElement(_tmpl$4),
    _el$9 = _el$6.firstChild,
    [_el$0, _co$2] = _$getNextMarker(_el$9.nextSibling),
    _el$1 = _el$0.nextSibling,
    [_el$10, _co$3] = _$getNextMarker(_el$1.nextSibling),
    _el$11 = _el$10.nextSibling,
    [_el$12, _co$4] = _$getNextMarker(_el$11.nextSibling);
  _$insert(
    _el$6,
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
            return _$getNextElement(_tmpl$3);
          }
        }
      )
    ),
    _el$0,
    _co$2
  );
  _$insert(
    _el$6,
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
            var _el$8 = _$getNextElement(_tmpl$2);
            _$insert(_el$8, content);
            return _el$8;
          }
        }
      )
    ),
    _el$10,
    _co$3
  );
  _$insert(
    _el$6,
    (() => {
      var _ref$4 = props.consumerRef();
      return _$createComponent(Context.Consumer, {
        ref(r$) {
          (typeof _ref$4 === "function" || Array.isArray(_ref$4)) && _$applyRef(_ref$4, r$);
        },
        children: context => context
      });
    })(),
    _el$12,
    _co$4
  );
  return _el$6;
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
    return [
      _$getNextElement(_tmpl$2),
      _$getNextElement(_tmpl$2),
      _$getNextElement(_tmpl$2),
      "After"
    ];
  }
});
const [s, set] = createSignal();
const template4 = _$createComponent(Child, {
  ref: set,
  get children() {
    return _$getNextElement(_tmpl$2);
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
    return [_$getNextElement(_tmpl$2), _$memo(() => state.dynamic)];
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
var _el$18 = _$getNextElement(_tmpl$5),
  _el$24 = _el$18.firstChild,
  [_el$25, _co$5] = _$getNextMarker(_el$24.nextSibling),
  _el$19 = _el$25.nextSibling,
  _el$26 = _el$19.nextSibling,
  [_el$27, _co$6] = _$getNextMarker(_el$26.nextSibling),
  _el$20 = _el$27.nextSibling,
  _el$28 = _el$20.nextSibling,
  [_el$29, _co$7] = _$getNextMarker(_el$28.nextSibling),
  _el$21 = _el$29.nextSibling,
  _el$30 = _el$21.nextSibling,
  [_el$31, _co$8] = _$getNextMarker(_el$30.nextSibling),
  _el$22 = _el$31.nextSibling,
  _el$32 = _el$22.nextSibling,
  [_el$33, _co$9] = _$getNextMarker(_el$32.nextSibling),
  _el$23 = _el$33.nextSibling,
  _el$34 = _el$23.nextSibling,
  [_el$35, _co$0] = _$getNextMarker(_el$34.nextSibling);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$25,
  _co$5
);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$27,
  _co$6
);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$29,
  _co$7
);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$31,
  _co$8
);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$33,
  _co$9
);
_$insert(
  _el$18,
  _$createComponent(Link, {
    children: "submit"
  }),
  _el$35,
  _co$0
);
const template10 = _el$18;
var _el$36 = _$getNextElement(_tmpl$6),
  _el$40 = _el$36.firstChild,
  [_el$41, _co$1] = _$getNextMarker(_el$40.nextSibling),
  _el$37 = _el$41.nextSibling,
  _el$42 = _el$37.nextSibling,
  [_el$43, _co$10] = _$getNextMarker(_el$42.nextSibling),
  _el$44 = _el$43.nextSibling,
  [_el$45, _co$11] = _$getNextMarker(_el$44.nextSibling),
  _el$38 = _el$45.nextSibling,
  _el$46 = _el$38.nextSibling,
  [_el$47, _co$12] = _$getNextMarker(_el$46.nextSibling),
  _el$48 = _el$47.nextSibling,
  [_el$49, _co$13] = _$getNextMarker(_el$48.nextSibling),
  _el$39 = _el$49.nextSibling,
  _el$50 = _el$39.nextSibling,
  [_el$51, _co$14] = _$getNextMarker(_el$50.nextSibling);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "new"
  }),
  _el$41,
  _co$1
);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$43,
  _co$10
);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$45,
  _co$11
);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "ask"
  }),
  _el$47,
  _co$12
);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "jobs"
  }),
  _el$49,
  _co$13
);
_$insert(
  _el$36,
  _$createComponent(Link, {
    children: "submit"
  }),
  _el$51,
  _co$14
);
const template11 = _el$36;
var _el$52 = _$getNextElement(_tmpl$7),
  _el$53 = _el$52.firstChild,
  _el$58 = _el$53.nextSibling,
  [_el$59, _co$15] = _$getNextMarker(_el$58.nextSibling),
  _el$54 = _el$59.nextSibling,
  _el$60 = _el$54.nextSibling,
  [_el$61, _co$16] = _$getNextMarker(_el$60.nextSibling),
  _el$57 = _el$61.nextSibling;
_$insert(
  _el$52,
  _$createComponent(Link, {
    children: "comments"
  }),
  _el$59,
  _co$15
);
_$insert(
  _el$52,
  _$createComponent(Link, {
    children: "show"
  }),
  _el$61,
  _co$16
);
const template12 = _el$52;
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
      _$getNextElement(_tmpl$8),
      " ",
      _$getNextElement(_tmpl$9),
      " ",
      _$getNextElement(_tmpl$0)
    ];
  }
});
const Template18 = _$createComponent(Pre, {
  get children() {
    return [_$getNextElement(_tmpl$8), _$getNextElement(_tmpl$9), _$getNextElement(_tmpl$0)];
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
  get disabled() {
    return "t" in test;
  },
  get children() {
    return "t" in test && "true";
  }
});
const template24 = _$createComponent(Component, {
  get children() {
    return state.dynamic;
  }
});
const template25 = _$createComponent(Component, {
  get children() {
    return _$getNextElement(_tmpl$2);
  }
});
