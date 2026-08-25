const template = (
  <div $ServerOnly>
    <h1>Hello</h1>
    <Component />
    {state.interpolation}
    <span>More Text</span>
  </div>
);

const template2 = (
  <Component>
    <div $ServerOnly />
  </Component>
);

const template3 = (
  <Component>
    <div $ServerOnly />
    <span $ServerOnly />
  </Component>
);

const template4 = (
  <>
    <div $ServerOnly />
  </>
);
