// Link claims (solidjs/solid#3878): a candidate anchor gets one hole after
// its attributes — `_$ssrLinkClaim(attrs)` — where a render's link handler
// writes the anchor's link state into the server HTML, `""` otherwise.

// Static anchors: one eager call over a hoisted attributes object, shared by
// every anchor that writes the same attributes.
const nav = (
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/about" rel="noopener">
      About (rel travels)
    </a>
    <a href="/docs" link>
      explicit-links marker travels
    </a>
    <a href="/x" target="">
      empty target is still a link
    </a>
    <a href="https://example.com/x">http(s) may be this origin: the handler decides</a>
    <a href="//cdn.example.com/x">protocol-relative too</a>
  </nav>
);

// Ruled out at compile time — no hole, no per-render call: these can never
// be the current page whatever the request looks like.
const excluded = (
  <nav>
    <a href="/about" target="_blank">
      target
    </a>
    <a href="/file.pdf" download>
      download
    </a>
    <a href="/x" rel="nofollow external">
      rel external
    </a>
    <a href="/x" aria-current="page">
      the author's aria-current
    </a>
    <a href="mailto:a@b.c">mailto</a>
    <a href="tel:+1">tel</a>
    <a href="">empty</a>
    <a>no href</a>
    <a xlink:href={url}>not the href attribute</a>
  </nav>
);

// Dynamic anchors: the attribute hole evaluates the raw value once into a
// temp the link hole reads after it, inside the element's attribute group.
const member = <a href={props.to}>member</a>;
const template = <a href={`/users/${props.id}`}>template literal keeps its quoted slot</a>;
const dynamicTarget = (
  <a href={props.to} target={props.target}>
    every dynamic link attribute travels
  </a>
);
const staticHrefDynamicTarget = (
  <a href="/x" target={props.target}>
    mixed
  </a>
);
const dynamicAriaCurrent = (
  <a href={props.to} aria-current={props.current}>
    the runtime applies the author's precedence
  </a>
);
const nonDynamic = <a href={to}>eager hole after an eager attribute</a>;
const conditional = <a href={cond ? "/a" : "/b"}>conditional</a>;
const otherDynamics = (
  <a href="/x" class={props.cls} title={props.title}>
    static link attributes stay hoisted
  </a>
);

// Spread anchors: `ssrElement` collects the link attributes from the walk,
// so an anchor's trailing link attributes stay a source instead of baked
// tail markup.
const spread = <a {...props}>spread</a>;
const spreadTrailingHref = (
  <a {...props} href="/x" class="c">
    trailing href stays a source
  </a>
);
const spreadDynamicHref = (
  <a {...props} href={props.to}>
    dynamic trailing href
  </a>
);
