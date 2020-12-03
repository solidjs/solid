import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-dom";
import { For as _$For } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { assignProps as _$assignProps } from "r-dom";
import { insert as _$insert } from "r-dom";

const _tmpl$ = _$template(`<div>Hello </div>`, 2),
  _tmpl$2 = _$template(`<div></div>`, 2),
  _tmpl$3 = _$template(`<div>From Parent</div>`, 2),
  _tmpl$4 = _$template(`<div> | <!----> | <!----> | <!----> | <!----> | </div>`, 6),
  _tmpl$5 = _$template(`<div> | <!----> | <!----> | </div>`, 4),
  _tmpl$6 = _$template(`<div> | <!----> |  |  | <!----> | </div>`, 4);

import { Show } from "somewhere";

const Child = props => [
  (() => {
    const _el$ = _tmpl$.cloneNode(true),
      _el$2 = _el$.firstChild;

    const _ref$ = props.ref;
    typeof _ref$ === "function" ? _ref$(_el$) : (props.ref = _el$);

    _$insert(_el$, () => props.name, null);

    return _el$;
  })(),
  (() => {
    const _el$3 = _tmpl$2.cloneNode(true);

    _$insert(_el$3, () => props.children);

    return _el$3;
  })()
];

const template = props => {
  let childRef;
  const { content } = props;
  return (() => {
    const _el$4 = _tmpl$2.cloneNode(true);

    _$insert(
      _el$4,
      _$createComponent(
        Child,
        _$assignProps(
          {
            name: "John"
          },
          props,
          {
            ref(r$) {
              const _ref$2 = childRef;
              typeof _ref$2 === "function" ? _ref$2(r$) : (childRef = r$);
            },

            booleanProperty: true,

            get children() {
              return _tmpl$3.cloneNode(true);
            }
          }
        )
      ),
      null
    );

    _$insert(
      _el$4,
      _$createComponent(Child, {
        name: "Jason",

        ref(r$) {
          const _ref$3 = props.ref;
          typeof _ref$3 === "function" ? _ref$3(r$) : (props.ref = r$);
        },

        get children() {
          const _el$6 = _tmpl$2.cloneNode(true);

          _$insert(_el$6, content);

          return _el$6;
        }
      }),
      null
    );

    _$insert(
      _el$4,
      _$createComponent(Context.Consumer, {
        ref(r$) {
          const _ref$4 = props.consumerRef();

          typeof _ref$4 === "function" && _ref$4(r$);
        },

        children: context => context
      }),
      null
    );

    return _el$4;
  })();
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
    return [_tmpl$2.cloneNode(true), _tmpl$2.cloneNode(true), _tmpl$2.cloneNode(true), "After"];
  }
});

const template4 = _$createComponent(Child, {
  get children() {
    return _tmpl$2.cloneNode(true);
  }
});

const template5 = _$createComponent(Child, {
  get dynamic() {
    return state.dynamic;
  },

  get children() {
    return state.dynamic;
  }
}); // builtIns

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
    return [_tmpl$2.cloneNode(true), _$memo(() => state.dynamic)];
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

const template10 = (() => {
  const _el$12 = _tmpl$4.cloneNode(true),
    _el$13 = _el$12.firstChild,
    _el$18 = _el$13.nextSibling,
    _el$14 = _el$18.nextSibling,
    _el$19 = _el$14.nextSibling,
    _el$15 = _el$19.nextSibling,
    _el$20 = _el$15.nextSibling,
    _el$16 = _el$20.nextSibling,
    _el$21 = _el$16.nextSibling,
    _el$17 = _el$21.nextSibling;

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "new"
    }),
    _el$13
  );

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "comments"
    }),
    _el$18
  );

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "show"
    }),
    _el$19
  );

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "ask"
    }),
    _el$20
  );

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "jobs"
    }),
    _el$21
  );

  _$insert(
    _el$12,
    _$createComponent(Link, {
      children: "submit"
    }),
    null
  );

  return _el$12;
})();

const template11 = (() => {
  const _el$22 = _tmpl$5.cloneNode(true),
    _el$23 = _el$22.firstChild,
    _el$26 = _el$23.nextSibling,
    _el$24 = _el$26.nextSibling,
    _el$27 = _el$24.nextSibling,
    _el$25 = _el$27.nextSibling;

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "new"
    }),
    _el$23
  );

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "comments"
    }),
    _el$26
  );

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "show"
    }),
    _el$26
  );

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "ask"
    }),
    _el$27
  );

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "jobs"
    }),
    _el$27
  );

  _$insert(
    _el$22,
    _$createComponent(Link, {
      children: "submit"
    }),
    null
  );

  return _el$22;
})();

const template12 = (() => {
  const _el$28 = _tmpl$6.cloneNode(true),
    _el$29 = _el$28.firstChild,
    _el$34 = _el$29.nextSibling,
    _el$30 = _el$34.nextSibling,
    _el$35 = _el$30.nextSibling,
    _el$33 = _el$35.nextSibling;

  _$insert(
    _el$28,
    _$createComponent(Link, {
      children: "comments"
    }),
    _el$34
  );

  _$insert(
    _el$28,
    _$createComponent(Link, {
      children: "show"
    }),
    _el$35
  );

  return _el$28;
})();

class Template13 {
  render() {
    const _self$ = this;

    _$createComponent(Component, {
      get prop() {
        return _self$.something;
      },

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
