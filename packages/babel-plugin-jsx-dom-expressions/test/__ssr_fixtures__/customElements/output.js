import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";

const template = _$ssr(
  ['<my-element some-attr="', '" notprop="', '" my-attr="', '"></my-element>'],
  _$escape(name, true),
  _$escape(data, true),
  _$escape(data, true)
);

const template2 = _$ssr(
  ['<my-element some-attr="', '" notprop="', '" my-attr="', '"></my-element>'],
  _$escape(state.name, true),
  _$escape(state.data, true),
  _$escape(state.data, true)
);

const template3 = _$ssr('<my-element><header slot="head">Title</header></my-element>');

const template4 = _$ssr('<slot name="head"></slot>');
