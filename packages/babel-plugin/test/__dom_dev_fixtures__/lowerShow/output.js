import { template as _$template } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<h1>Welcome`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<p>Sign in`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><span>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<b>total`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<b>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<i>none`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<i>`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<div>`);
import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];

// Lowered: JSX children, with and without a fallback.
const Root = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      get fallback() {
        return _tmpl$2();
      },
      get children() {
        return _tmpl$();
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:10:3"
  );
const InElement = props =>
  (() => {
    var _el$3 = _tmpl$3(),
      _el$4 = _el$3.firstChild;
    _$insert(
      _el$3,
      _$createComponent(
        Show,
        {
          get when() {
            return props.open;
          },
          get children() {
            return ["hi ", _$memo(() => props.name)];
          }
        },
        "Show",
        "test/__dom_dev_fixtures__/lowerShow/code.js:16:5"
      ),
      _el$4
    );
    return _el$3;
  })();
const InFragment = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return total() > 1;
      },
      children: "many"
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:22:5"
  );
const SoleComponentChild = () =>
  _$createComponent(
    Panel,
    {
      get children() {
        return _$createComponent(
          Show,
          {
            get when() {
              return total();
            },
            get children() {
              return _tmpl$4();
            }
          },
          "Show",
          "test/__dom_dev_fixtures__/lowerShow/code.js:27:5"
        );
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:26:3"
  );
const Renamed = () =>
  _$createComponent(
    Visible,
    {
      get when() {
        return user();
      },
      children: "renamed"
    },
    "Visible",
    "test/__dom_dev_fixtures__/lowerShow/code.js:32:23"
  );
const Empty = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:33:21"
  );

// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      children: u =>
        (() => {
          var _el$6 = _tmpl$5();
          _$insert(_el$6, () => u().name, undefined, undefined, {
            name: "b.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:36:68"
          });
          _$effect(
            () => u().id,
            _v$ => {
              _$setAttribute(_el$6, "title", _v$);
            },
            {
              name: "b.title",
              loc: "test/__dom_dev_fixtures__/lowerShow/code.js:36:53"
            }
          );
          return _el$6;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:36:24"
  );
const CallbackMember = props =>
  _$createComponent(
    Show,
    {
      get when() {
        return props.user?.profile;
      },
      get fallback() {
        return _tmpl$6();
      },
      children: profile =>
        _$createComponent(
          Card,
          {
            profile: profile,
            get name() {
              return profile().name;
            }
          },
          "Card",
          "test/__dom_dev_fixtures__/lowerShow/code.js:39:17"
        )
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:38:3"
  );
const Nested = props =>
  _$createComponent(
    Show,
    {
      get when() {
        return props.a;
      },
      get children() {
        return _$createComponent(
          Show,
          {
            get when() {
              return props.b;
            },
            children: b =>
              (() => {
                var _el$8 = _tmpl$7();
                _$insert(_el$8, () => b().c, undefined, undefined, {
                  name: "i.children",
                  loc: "test/__dom_dev_fixtures__/lowerShow/code.js:44:35"
                });
                return _el$8;
              })()
          },
          "Show",
          "test/__dom_dev_fixtures__/lowerShow/code.js:44:5"
        );
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:43:3"
  );

// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      keyed: true,
      children: u =>
        (() => {
          var _el$9 = _tmpl$5();
          _$insert(_el$9, () => u.name, undefined, undefined, {
            name: "b.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:51:14"
          });
          return _el$9;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:50:3"
  );
const Spread = props =>
  _$createComponent(
    Show,
    _$mergeProps(props, {
      children: "x"
    }),
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:54:25"
  );
const Other = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      name: "x",
      children: "x"
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:56:3"
  );
const Bare = () =>
  _$createComponent(
    Show,
    {
      when: true,
      children: "x"
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:60:20"
  );
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return load();
      },
      children: u =>
        (() => {
          var _el$0 = _tmpl$5();
          _$insert(_el$0, () => u().name, undefined, undefined, {
            name: "b.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:62:52"
          });
          return _el$0;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:62:23"
  );
const Mutable = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return mutable();
      },
      children: u =>
        (() => {
          var _el$1 = _tmpl$5();
          _$insert(_el$1, u, undefined, undefined, {
            name: "b.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:63:55"
          });
          return _el$1;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:63:23"
  );
const Block = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      children: u => {
        var _el$10 = _tmpl$5();
        _$insert(_el$10, () => u().name, undefined, undefined, {
          name: "b.children",
          loc: "test/__dom_dev_fixtures__/lowerShow/code.js:67:17"
        });
        return _el$10;
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:65:3"
  );
const Shadowed = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      children: u =>
        (() => {
          var _el$11 = _tmpl$5();
          _$insert(_el$11, () => [1].map(user => u().name + user), undefined, undefined, {
            name: "b.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:71:53"
          });
          return _el$11;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:71:24"
  );
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = props =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      get children() {
        return props.render;
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:74:25"
  );
const Siblings = () =>
  _$createComponent(
    Panel,
    {
      get children() {
        return [
          _$createComponent(
            Show,
            {
              get when() {
                return user();
              },
              children: "x"
            },
            "Show",
            "test/__dom_dev_fixtures__/lowerShow/code.js:77:5"
          ),
          _tmpl$7()
        ];
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:76:3"
  );
const Attribute = () =>
  _$createComponent(
    Panel,
    {
      get fallback() {
        return _$createComponent(
          Show,
          {
            get when() {
              return user();
            },
            children: "x"
          },
          "Show",
          "test/__dom_dev_fixtures__/lowerShow/code.js:81:42"
        );
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:81:25"
  );
const InExpression = props =>
  (() => {
    var _el$13 = _tmpl$8();
    _$insert(
      _el$13,
      (() => {
        var _c$ = _$memo(() => !!props.ok);
        return () =>
          _c$()
            ? _$createComponent(
                Show,
                {
                  get when() {
                    return user();
                  },
                  children: "x"
                },
                "Show",
                "test/__dom_dev_fixtures__/lowerShow/code.js:82:49"
              )
            : props.ok;
      })(),
      undefined,
      undefined,
      {
        name: "div.children",
        loc: "test/__dom_dev_fixtures__/lowerShow/code.js:82:36"
      }
    );
    return _el$13;
  })();
// Kept: not Solid's `<Show>`.
const Local = () => {
  const Show = props => props.children;
  return _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      children: "x"
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:86:10"
  );
};
