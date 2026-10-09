// Element claims (#3923): `a[href]` / `form[action]` are claimed once, after
// their initial attributes are applied.

// Fully static: attributes in the template, claimed at creation.
const staticLink = <a href="/static">Static</a>;

// Non-reactive expression attributes write at creation; with a ref, the
// claim trails both.
const staticWrites = (
  <a href={base} title={label} ref={link}>
    Written
  </a>
);

// One dynamic binding: the claim is the tail of the binding effect, under
// the owner captured at creation.
const oneBinding = <a href={href()}>One</a>;

// Several bindings on the target, including ones outside the default
// re-claim set.
const manyBindings = (
  <a href="/docs" target={target()} rel={rel()} download={download()}>
    Many
  </a>
);

// Nested under a template root with bindings on other elements: one effect,
// the claim after every binding; the static sibling is claimed at creation.
const nested = (
  <div>
    <a href={first()}>First</a>
    <span title={title()} />
    <a href="/second">Second</a>
  </div>
);

// A form claims on `action`.
const form = <form action={action()} method="post" />;

// A spread may carry the attribute: the spread runtime claims after its
// first application, so no compiled claim.
const spread = <a {...props} />;
const spreadMixed = <a href={href()} {...rest} target="_blank" />;
