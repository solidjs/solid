const template = <my-element some-attr={name} notProp={data} my-attr={data} prop:someProp={data} />;

const template2 = (
  <my-element
    some-attr={state.name}
    notProp={state.data}
    my-attr={state.data}
    prop:someProp={state.data}
  />
);

const template3 = (
  <my-element>
    <header slot="head">Title</header>
  </my-element>
);

const template4 = (
  <>
    <slot name="head"></slot>
  </>
);

const template5 = <a is="my-element" />;
