import { template as _$template } from "r-dom";
import { assignProps as _$assignProps } from "r-dom";
import { spread as _$spread } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";

const _tmpl$ = _$template(`<div></div>`, 2),
  _tmpl$2 = _$template(`<module></module>`, 2),
  _tmpl$3 = _$template(`<module>Hello</module>`, 2),
  _tmpl$4 = _$template(`<module>Hi </module>`, 2);

const children = _tmpl$.cloneNode(true);

const dynamic = {
  children
};

const template = _$createComponent(Module, {
  children: children
});

const template2 = (() => {
  const _el$2 = _tmpl$2.cloneNode(true);

  _$insert(_el$2, children);

  return _el$2;
})();

const template3 = _tmpl$3.cloneNode(true);

const template4 = (() => {
  const _el$4 = _tmpl$2.cloneNode(true);

  _$insert(_el$4, _$createComponent(Hello, {}));

  return _el$4;
})();

const template5 = (() => {
  const _el$5 = _tmpl$2.cloneNode(true);

  _$insert(_el$5, () => dynamic.children);

  return _el$5;
})();

const template6 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});

const template7 = (() => {
  const _el$6 = _tmpl$2.cloneNode(true);

  _$spread(_el$6, dynamic, false, false);

  return _el$6;
})();

const template8 = (() => {
  const _el$7 = _tmpl$3.cloneNode(true);

  _$spread(_el$7, dynamic, false, true);

  return _el$7;
})();

const template9 = (() => {
  const _el$8 = _tmpl$2.cloneNode(true);

  _$spread(_el$8, dynamic, false, true);

  _$insert(_el$8, () => dynamic.children);

  return _el$8;
})();

const template10 = _$createComponent(
  Module,
  _$assignProps(dynamic, {
    children: "Hello"
  })
);

const template11 = (() => {
  const _el$9 = _tmpl$2.cloneNode(true);

  _$insert(_el$9, state.children);

  return _el$9;
})();

const template12 = _$createComponent(Module, {
  children: state.children
});

const template13 = (() => {
  const _el$10 = _tmpl$2.cloneNode(true);

  _$insert(_el$10, children);

  return _el$10;
})();

const template14 = _$createComponent(Module, {
  children: children
});

const template15 = (() => {
  const _el$11 = _tmpl$2.cloneNode(true);

  _$insert(_el$11, () => dynamic.children);

  return _el$11;
})();

const template16 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});

const template18 = (() => {
  const _el$12 = _tmpl$4.cloneNode(true);

  _$insert(_el$12, children, null);

  return _el$12;
})();

const template19 = _$createComponent(Module, {
  get children() {
    return ["Hi ", children];
  }
});

const template20 = (() => {
  const _el$13 = _tmpl$2.cloneNode(true);

  _$insert(_el$13, children);

  return _el$13;
})();

const template21 = _$createComponent(Module, {
  get children() {
    return children();
  }
});

const template22 = (() => {
  const _el$14 = _tmpl$2.cloneNode(true);

  _$insert(_el$14, () => state.children());

  return _el$14;
})();

const template23 = _$createComponent(Module, {
  get children() {
    return state.children();
  }
});
