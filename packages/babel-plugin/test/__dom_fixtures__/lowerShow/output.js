import { template as _$template } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<h1>Welcome`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<label>Sign in`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><span>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>total`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<label>none`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<label>`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<div>`);
import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];

// Lowered: JSX children, with and without a fallback.
const Root = () => _$memo(() => (_$memo(() => !!user())() ? _tmpl$() : _tmpl$2()));
const InElement = props =>
  (() => {
    var _el$3 = _tmpl$3(),
      _el$4 = _el$3.firstChild;
    _$insert(
      _el$3,
      (() => {
        var _c$ = _$memo(() => !!props.open);
        return () => (_c$() ? ["hi ", _$memo(() => props.name)] : void 0);
      })(),
      _el$4
    );
    return _el$3;
  })();
const InFragment = () => _$memo(() => (_$memo(() => total() > 1)() ? "many" : void 0));
const SoleComponentChild = () =>
  _$createComponent(Panel, {
    get children() {
      return _$memo(() => (_$memo(() => !!total())() ? _tmpl$4() : void 0));
    }
  });
const Renamed = () => _$memo(() => (_$memo(() => !!user())() ? "renamed" : void 0));
const Empty = () => _$memo(() => (user() ? void 0 : void 0));

// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () =>
  _$memo(() =>
    _$memo(() => !!user())()
      ? (() => {
          var _el$6 = _tmpl$5();
          _$insert(_el$6, () => user().name);
          _$effect(
            () => user().id,
            _v$ => {
              _$setAttribute(_el$6, "title", _v$);
            }
          );
          return _el$6;
        })()
      : void 0
  );
const CallbackMember = props =>
  _$memo(() =>
    _$memo(() => !!props.user?.profile)()
      ? _$createComponent(Card, {
          profile: () => props.user?.profile,
          get name() {
            return (props.user?.profile).name;
          }
        })
      : _tmpl$6()
  );
const Nested = props =>
  _$memo(() =>
    _$memo(() => !!props.a)()
      ? _$memo(() =>
          _$memo(() => !!props.b)()
            ? (() => {
                var _el$8 = _tmpl$7();
                _$insert(_el$8, () => props.b.c);
                return _el$8;
              })()
            : void 0
        )
      : void 0
  );

// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () =>
  _$createComponent(Show, {
    get when() {
      return user();
    },
    keyed: true,
    children: u =>
      (() => {
        var _el$9 = _tmpl$5();
        _$insert(_el$9, () => u.name);
        return _el$9;
      })()
  });
const Spread = props =>
  _$createComponent(
    Show,
    _$mergeProps(props, {
      children: "x"
    })
  );
const Other = () =>
  _$createComponent(Show, {
    get when() {
      return user();
    },
    name: "x",
    children: "x"
  });
const Bare = () =>
  _$createComponent(Show, {
    when: true,
    children: "x"
  });
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () =>
  _$createComponent(Show, {
    get when() {
      return load();
    },
    children: u =>
      (() => {
        var _el$0 = _tmpl$5();
        _$insert(_el$0, () => u().name);
        return _el$0;
      })()
  });
const Mutable = () =>
  _$createComponent(Show, {
    get when() {
      return mutable();
    },
    children: u =>
      (() => {
        var _el$1 = _tmpl$5();
        _$insert(_el$1, u);
        return _el$1;
      })()
  });
const Block = () =>
  _$createComponent(Show, {
    get when() {
      return user();
    },
    children: u => {
      var _el$10 = _tmpl$5();
      _$insert(_el$10, () => u().name);
      return _el$10;
    }
  });
const Shadowed = () =>
  _$createComponent(Show, {
    get when() {
      return user();
    },
    children: u =>
      (() => {
        var _el$11 = _tmpl$5();
        _$insert(_el$11, () => [1].map(user => u().name + user));
        return _el$11;
      })()
  });
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = props =>
  _$createComponent(Show, {
    get when() {
      return user();
    },
    get children() {
      return props.render;
    }
  });
const Siblings = () =>
  _$createComponent(Panel, {
    get children() {
      return [
        _$createComponent(Show, {
          get when() {
            return user();
          },
          children: "x"
        }),
        _tmpl$7()
      ];
    }
  });
const Attribute = () =>
  _$createComponent(Panel, {
    get fallback() {
      return _$createComponent(Show, {
        get when() {
          return user();
        },
        children: "x"
      });
    }
  });
const InExpression = props =>
  (() => {
    var _el$13 = _tmpl$8();
    _$insert(
      _el$13,
      (() => {
        var _c$2 = _$memo(() => !!props.ok);
        return () =>
          _c$2()
            ? _$createComponent(Show, {
                get when() {
                  return user();
                },
                children: "x"
              })
            : props.ok;
      })()
    );
    return _el$13;
  })();
// Kept: not Solid's `<Show>`.
const Local = () => {
  const Show = props => props.children;
  return _$createComponent(Show, {
    get when() {
      return user();
    },
    children: "x"
  });
};
