import * as styles from "./styles.module.css";
import { binding } from "somewhere";

function refFn() {}
const refConst = null;

const selected = true;
let id = "my-h1";
let link;
const template = (
  <div id="main" {...results} class={{ selected: unknown }} style={{ color }}>
    <h1
      id={id}
      {...results()}
      foo
      disabled
      title={welcoming()}
      style={{ "background-color": color(), "margin-right": "40px" }}
      class={["base", { dynamic: dynamic(), selected }]}
    >
      <a href={"/"} ref={link} class={{ "ccc ddd": true }}>
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
    foo
    id={/*@static*/ state.id}
    style={/*@static*/ { "background-color": state.color }}
    name={state.name}
    textContent={/*@static*/ state.content}
  />
);

const template4 = <div className={state.class} class={{ "ccc:ddd": true }} />;

const template5 = <div class="a" className="b"></div>;

const template6 = <div style={someStyle()} textContent="Hi" />;

let undefVar;
const template7 = (
  <div
    style={{ "background-color": color(), "margin-right": "40px", ...props.style }}
    class={{ "other-class2": undefVar }}
  />
);

let refTarget;
const template8 = <div ref={refTarget} />;

const template9 = <div ref={e => console.log(e)} />;

const template10 = <div ref={refFactory()} />;

const template12 = <div prop:htmlFor={thing} prop:number={123} onclick="console.log('hi')" />;

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

const template19 = <div class={[{ "bg-red-500": true }, "flex flex-col"]} />;

const template20 = (
  <div>
    <input value={s()} min={min()} max={max()} onInput={doSomething} readonly="" />
    <input checked={s2()} min={min()} max={max()} onInput={doSomethingElse} readonly={value} />
  </div>
);

const template21 = <div style={{ a: "static", ...rest }}></div>;

const template22 = <div data='"hi"' data2={'"'} />;

const template23 = <div disabled={"t" in test}>{"t" in test && "true"}</div>;

const template24 = <a {...props} something />;

const template25 = (
  <div>
    {props.children}
    <a {...props} something />
  </div>
);

const template26 = (
  <div start="Hi" middle={middle} {...spread}>
    Hi
  </div>
);

const template27 = (
  <div start="Hi" {...first} middle={middle} {...second}>
    Hi
  </div>
);

const template28 = (
  <label {...api()}>
    <span {...api()}>Input is {api() ? "checked" : "unchecked"}</span>
    <input {...api()} />
    <div {...api()} />
  </label>
);

const template29 = <div attribute={!!someValue}>{!!someValue}</div>;

const template30 = (
  <div
    class="class1 class2
    class3 class4
    class5 class6"
    style="color: red;
    background-color: blue !important;
    border: 1px solid black;
    font-size: 12px;"
    random="random1 random2
    random3 random4"
  />
);

const template31 = <div style={{ "background-color": getStore.itemProperties.color }} />;

const template32 = <div style={{ "background-color": undefined }} />;

const template33 = (
  <>
    <button class={styles.button}></button>
    <button class={styles["foo--bar"]}></button>
    <button class={styles.foo.bar}></button>
    <button class={styles[foo()]}></button>
  </>
);

const template35 = <div ref={a().b.c} />;

const template36 = <div ref={a().b?.c} />;

const template37 = <div ref={a() ? b : c} />;

const template38 = <div ref={a() ?? b} />;

const template39 = <input value={10} />;

const template40 = <div style={{ color: a() }} />;

const template41 = (
  <select value={state.color}>
    <option value={Color.Red}>Red</option>
    <option value={Color.Blue}>Blue</option>
  </select>
);

const template42 = <img src="" />;
const template43 = (
  <div>
    <img src="" />
  </div>
);

const template44 = <img src="" loading="lazy" />;
const template45 = (
  <div>
    <img src="" loading="lazy" />
  </div>
);

const template46 = <iframe src=""></iframe>;
const template47 = (
  <div>
    <iframe src=""></iframe>
  </div>
);

const template48 = <iframe src="" loading="lazy"></iframe>;
const template49 = (
  <div>
    <iframe src="" loading="lazy"></iframe>
  </div>
);

const template50 = <div title="<u>data</u>" />;

const template51 = <div ref={binding} />;
const template52 = <div ref={binding.prop} />;
const template53 = <div ref={refFn} />;
const template54 = <div ref={refConst} />;

const template55 = <div ref={refUnknown} />;

const template56 = <div true={true} truestr="true" truestrjs={"true"} />;
const template57 = <div false={false} falsestr="false" falsestrjs={"false"} />;
const template58 = <div prop:true={true} prop:false={false} />;

const template59 = <div true={true} false={false} />;
const template60 = (
  <div a b="" c="" d={true} e={false} f={0} g={""} h={""} i={undefined} j={null} k={void 0} l />
);

const template61 = (
  <math display="block">
    <mrow></mrow>
  </math>
);
const template62 = (
  <mrow>
    <mi>x</mi>
    <mo>=</mo>
  </mrow>
);

const template63 = <div style={{ background: "red" }} />;
const template64 = <div style={{ background: "red", color: "green", margin: 3, padding: 0.4 }} />;
const template65 = <div style={{ background: "red", color: "green", border: undefined }} />;
const template66 = <div style={{ background: "red", color: "green", border: signal() }} />;
const template67 = <div style={{ background: "red", color: "green", border: somevalue }} />;
const template68 = <div style={{ background: "red", color: "green", border: some.access }} />;
const template69 = <div style={{ background: "red", color: "green", border: null }} />;
const template70 = <video playsinline={value} />;
const template71 = <video playsinline={true} />;
const template72 = <video playsinline={false} />;
const template73 = <video poster="1.jpg" />;
const template74 = (
  <div>
    <video poster="1.jpg" />
  </div>
);
const template75 = <video prop:poster="1.jpg" />;
const template76 = (
  <div>
    <video prop:poster="1.jpg" />
  </div>
);

// STATIC TESTS

const template77 = <div style={/*@static*/ { width: props.width, height: props.height }} />;

const template78 = (
  <div style={/*@static*/ { width: props.width, height: props.height }} something={color()} />
);

const template79 = (
  <div
    style={{ width: props.width, height: /* @static */ props.height }}
    something={/*@static*/ color()}
  />
);

// STATIC TESTS SPREADS

const propsSpread = {
  something: color(),
  style: {
    "background-color": color(),
    color: /* @static*/ color(),
    "margin-right": /* @static */ props.right
  }
};

const template80 = <div {...propsSpread} />;
const template81 = <div {/* @static */ ...propsSpread} />;

const template82 = (
  <div {...propsSpread} data-dynamic={color()} data-static={/* @static */ color()} />
);

const template83 = (
  <div {/* @static */ ...propsSpread} data-dynamic={color()} data-static={/* @static */ color()} />
);

const template84 = (
  <div
    {
      /* @static */ ...propsSpread1
    }
    {...propsSpread2}
    {
      /* @static */ ...propsSpread3
    }
    data-dynamic={color()}
    data-static={/* @static */ color()}
  />
);

// STATIC PROPERTY OF OBJECT ACCESS

// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = { style: { width: props.width, height: props.height } };
const template85 = <div style={/* @static */ styleProp.style} />;
const template86 = <div style={styleProp.style} />;

const style = {
  background: "red",
  border: "solid black " + count() + "px"
};

const template87 = (
  <button type="button" aria-label={count()} style={style} class={style}>
    {count()}
  </button>
);

const template88 = (
  <button type="button" aria-label={count()} style={/* @static*/ style} class={/* @static*/ style}>
    {count()}
  </button>
);

// Style edge cases from main
{
  <div
    style={{
      "padding-left": `clamp(${1 + 1}px, ${1 + 1}px, ${1 + 1}px)`
    }}
  />;
}
{
  <div
    style={{
      a: `clamp(${1 + 1}px, ${1 + 1}px, ${1 + 1}px)`
    }}
  />;
}
{
  <div
    style={{
      [computedkey]: `clamp(${1 + 1}px, ${1 + 1}px, ${1 + 1}px)`
    }}
  />;
}

{
  const o = { ref: null };
  const Div = _ => <></>;
  const valid = <Div ref={o.ref} />;
  const invalid = <Div ref={o?.ref} />;
}

const template89 = <div _hk="should warn _hk is present on template" />;

const template90 = <div style={{}} />;

const template91 = <video something={{ value: { value: 1 + 1 } }} />;

const template92 = <div style="duplicate1" style="duplicate2" />;

const template93 = (
  <div>
    <video muted={true} />
    <video muted={false} />
    <video defaultMuted={false} muted={dynamicProperty()} />
    <video defaultMuted={true} muted={dynamicProperty()} />
    <video defaultMuted={dynamicAttribute()} muted={dynamicProperty()} />
    <video src="test.mp4" muted />
  </div>
);

function MyVideo() {
  return <video src="test.mp4" muted />;
}

const template94 = <div class={["todo", { active: isActive() }]} />;

const template95 = <div class={["todo", props.active]} />;

const template96 = <div class={["todo", "item", { active: isActive() }]} />;

const template97 = <div class={["todo", { active: isActive(), [props.name]: props.enabled }]} />;

const template98 = <div class={["todo", { active: isActive() }, props.extra]} />;

const template99 = <div class={["todo", "item", { todo: false, active: isActive() }]} />;
