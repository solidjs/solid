import { template as _$template } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<h1>Welcome`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<label>Sign in`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><span>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>total`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<label>none`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<label>`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<div>`);
import { Show, createSignal, createMemo, createStore } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
const [state] = createStore({
  user: {
    profile: {
      name: ""
    }
  }
});

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
    "test/__dom_dev_fixtures__/lowerShow/code.js:11:3"
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
        "test/__dom_dev_fixtures__/lowerShow/code.js:17:5"
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:23:5"
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
          "test/__dom_dev_fixtures__/lowerShow/code.js:28:5"
        );
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:27:3"
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:33:23"
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:34:21"
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
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:37:71"
          });
          _$effect(
            () => u().id,
            _v$ => {
              _$setAttribute(_el$6, "title", _v$);
            },
            {
              name: "span.title",
              loc: "test/__dom_dev_fixtures__/lowerShow/code.js:37:56"
            }
          );
          return _el$6;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:37:24"
  );
const CallbackMember = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return state.user?.profile;
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
          "test/__dom_dev_fixtures__/lowerShow/code.js:40:17"
        )
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:39:3"
  );
const Nested = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      get children() {
        return _$createComponent(
          Show,
          {
            get when() {
              return state.user;
            },
            children: b =>
              (() => {
                var _el$8 = _tmpl$7();
                _$insert(_el$8, () => b().profile.name, undefined, undefined, {
                  name: "label.children",
                  loc: "test/__dom_dev_fixtures__/lowerShow/code.js:45:42"
                });
                return _el$8;
              })()
          },
          "Show",
          "test/__dom_dev_fixtures__/lowerShow/code.js:45:5"
        );
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:44:3"
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
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:52:17"
          });
          return _el$9;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:51:3"
  );
const Spread = props =>
  _$createComponent(
    Show,
    _$mergeProps(props, {
      children: "x"
    }),
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:55:25"
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:57:3"
  );
const Bare = () =>
  _$createComponent(
    Show,
    {
      when: true,
      children: "x"
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:61:20"
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
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:63:55"
          });
          return _el$0;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:63:23"
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
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:64:58"
          });
          return _el$1;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:64:23"
  );
// Kept: a prop's getter can make its JSX again on each read (#4936).
const PropChild = props =>
  _$createComponent(
    Show,
    {
      get when() {
        return props.children;
      },
      children: child =>
        (() => {
          var _el$10 = _tmpl$7();
          _$insert(_el$10, child, undefined, undefined, {
            name: "label.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:66:73"
          });
          return _el$10;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:66:28"
  );
const PropMember = props =>
  _$createComponent(
    Show,
    {
      get when() {
        return props.user?.profile;
      },
      children: p =>
        (() => {
          var _el$11 = _tmpl$5();
          _$insert(_el$11, () => p().name, undefined, undefined, {
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:67:74"
          });
          return _el$11;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:67:29"
  );
const Block = () =>
  _$createComponent(
    Show,
    {
      get when() {
        return user();
      },
      children: u => {
        var _el$12 = _tmpl$5();
        _$insert(_el$12, () => u().name, undefined, undefined, {
          name: "span.children",
          loc: "test/__dom_dev_fixtures__/lowerShow/code.js:71:20"
        });
        return _el$12;
      }
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:69:3"
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
          var _el$13 = _tmpl$5();
          _$insert(_el$13, () => [1].map(user => u().name + user), undefined, undefined, {
            name: "span.children",
            loc: "test/__dom_dev_fixtures__/lowerShow/code.js:76:35"
          });
          return _el$13;
        })()
    },
    "Show",
    "test/__dom_dev_fixtures__/lowerShow/code.js:76:3"
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:80:25"
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
            "test/__dom_dev_fixtures__/lowerShow/code.js:83:5"
          ),
          _tmpl$7()
        ];
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:82:3"
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
          "test/__dom_dev_fixtures__/lowerShow/code.js:87:42"
        );
      }
    },
    "Panel",
    "test/__dom_dev_fixtures__/lowerShow/code.js:87:25"
  );
const InExpression = props =>
  (() => {
    var _el$15 = _tmpl$8();
    _$insert(
      _el$15,
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
                "test/__dom_dev_fixtures__/lowerShow/code.js:88:49"
              )
            : props.ok;
      })(),
      undefined,
      undefined,
      {
        name: "div.children",
        loc: "test/__dom_dev_fixtures__/lowerShow/code.js:88:36"
      }
    );
    return _el$15;
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
    "test/__dom_dev_fixtures__/lowerShow/code.js:92:10"
  );
};
