// One binding → its own effect, named `<tag>.<attribute>`.
const single = <span textContent={label()} />;
const attr = <input value={text()} />;
const cls = <div class={active() ? "on" : "off"} />;
const style = <div style={{ color: color(), "font-size": size() }} />;
const classList = <div classList={{ active: active() }} />;
const ns = <div class:selected={selected()} style:width={width()} />;

// Several bindings in one template → one merged effect listing all of them.
const merged = (
  <button class={cls()} title={title()} disabled={off()}>
    <span textContent={label()} />
  </button>
);

// Holes → insert, named for the parent it fills.
const hole = <div>{count()}</div>;
const holes = (
  <div>
    Hello {name()}!<p>{greeting()}</p>
    {list()}
  </div>
);
const staticChild = <div>{"text"}</div>;
const componentChild = (
  <div>
    <Child />
  </div>
);

// Spreads → the tag rides as spread's trailing argument.
const spread = <div {...props} />;
const spreadWithChildren = <section {...props}>{children()}</section>;
const spreadMixed = <a href={href()} {...rest} title="static" />;
