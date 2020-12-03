import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { getHydrationKey as _$getHydrationKey } from "r-server";

const template = _$ssr(
  ['<my-element data-hk="', '" some-attr="', '" notprop="', '" my-attr="', '"></my-element>'],
  _$getHydrationKey(),
  _$escape(name, true),
  _$escape(data, true),
  _$escape(data, true)
);

const template2 = _$ssr(
  ['<my-element data-hk="', '" some-attr="', '" notprop="', '" my-attr="', '"></my-element>'],
  _$getHydrationKey(),
  _$escape(state.name, true),
  _$escape(state.data, true),
  _$escape(state.data, true)
);

const template3 = _$ssr(
  ['<my-element data-hk="', '"><header slot="head">Title</header></my-element>'],
  _$getHydrationKey()
);

const template4 = _$ssr(['<slot data-hk="', '" name="head"></slot>'], _$getHydrationKey());
