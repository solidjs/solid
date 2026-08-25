import { binding } from "somewhere";

function refFn() {}
const refConst = null;

const selected = true;
let link;
const template = (
  <div id="main" {...results} style={{ color }}>
    <h1
      class="base"
      {...results()}
      disabled
      readonly=""
      title={welcoming()}
      style={{ "background-color": color(), "margin-right": "40px" }}
      class={["base", { dynamic: dynamic(), selected }]}
    >
      <a href={"/"} ref={link} readonly={value}>
        Welcome
      </a>
    </h1>
  </div>
);

const template2 = (
  <div {...getProps("test")}>
    <div textContent={rowId} />
    <div textContent={row.label} />
    <div innerHTML={"<div/>"} />
  </div>
);

const template3 = (
  <div
    id={/*@static*/ state.id}
    style={/*@static*/ { "background-color": state.color }}
    name={state.name}
    textContent={/*@static*/ state.content}
  />
);

const template4 = <div className={state.class} class={{ "ccc:ddd": true }} />;

const template5 = <div class="a" className="b"></div>;

const template6 = <div style={someStyle()} textContent="Hi" />;

const template7 = (
  <div style={{ "background-color": color(), "margin-right": "40px", ...props.style }} />
);

let refTarget;
const template8 = <div ref={refTarget} />;

const template9 = <div ref={e => console.log(e)} />;

const template10 = <div ref={refFactory()} />;

const template12 = <div prop:htmlFor={thing} />;

const template13 = <input type="checkbox" checked={true} />;

const template14 = <input type="checkbox" checked={state.visible} />;

const template15 = <div class="`a">`$`</div>;

const template16 = (
  <button
    class={[
      "static",
      {
        hi: "k"
      }
    ]}
    type="button"
  >
    Write
  </button>
);

const template17 = (
  <button
    class={{
      a: true,
      b: true,
      c: true
    }}
    onClick={increment}
  >
    Hi
  </button>
);

const template18 = (
  <div
    {...{
      get [key()]() {
        return props.value;
      }
    }}
  />
);

const template19 = <div style={{ a: "static", ...rest }}></div>;

const template21 = <div ref={a().b.c} />;

const template22 = <div ref={a().b?.c} />;

const template23 = <div ref={a() ? b : c} />;

const template24 = <div ref={a() ?? b} />;

const template25 = <div ref={binding} />;
const template26 = <div ref={binding.prop} />;

const template27 = <div ref={refFn} />;
const template28 = <div ref={refConst} />;

const template29 = <div ref={refUnknown} />;
