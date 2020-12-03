import { assignProps as _$assignProps } from "r-server";
import { ssrSpread as _$ssrSpread } from "r-server";
import { escape as _$escape } from "r-server";
import { createComponent as _$createComponent } from "r-server";
import { ssr as _$ssr } from "r-server";

const children = _$ssr("<div></div>");

const dynamic = {
  children
};

const template = _$createComponent(Module, {
  children: children
});

const template2 = _$ssr(["<module>", "</module>"], _$escape(children));

const template3 = _$ssr("<module>Hello</module>");

const template4 = _$ssr(["<module>", "</module>"], _$createComponent(Hello, {}));

const template5 = _$ssr(["<module>", "</module>"], _$escape(dynamic.children));

const template6 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});

const template7 = _$ssr(["<module ", "></module>"], _$ssrSpread(dynamic, false, false));

const template8 = _$ssr(["<module ", ">Hello</module>"], _$ssrSpread(dynamic, false, true));

const template9 = _$ssr(
  ["<module ", ">", "</module>"],
  _$ssrSpread(dynamic, false, true),
  _$escape(dynamic.children)
);

const template10 = _$createComponent(
  Module,
  _$assignProps(dynamic, {
    children: "Hello"
  })
);

const template11 = _$ssr(["<module>", "</module>"], _$escape(state.children));

const template12 = _$createComponent(Module, {
  children: state.children
});

const template13 = _$ssr(["<module>", "</module>"], _$escape(children));

const template14 = _$createComponent(Module, {
  children: children
});

const template15 = _$ssr(["<module>", "</module>"], _$escape(dynamic.children));

const template16 = _$createComponent(Module, {
  get children() {
    return dynamic.children;
  }
});

const template18 = _$ssr(["<module>Hi ", "</module>"], _$escape(children));

const template19 = _$createComponent(Module, {
  get children() {
    return ["Hi ", children];
  }
});

const template20 = _$ssr(["<module>", "</module>"], _$escape(children()));

const template21 = _$createComponent(Module, {
  get children() {
    return children();
  }
});

const template22 = _$ssr(["<module>", "</module>"], _$escape(state.children()));

const template23 = _$createComponent(Module, {
  get children() {
    return state.children();
  }
});
