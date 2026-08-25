// Adversarial Babel-vs-Oxc parity probes.
//
// These inputs deliberately exercise interactions the fixture corpus doesn't:
// deeply nested JSX in attribute values, `this` capture placement across every
// function-parent kind (Babel's `transformThis` routes), zero-arg IIFE getter
// unwrapping, and SSR `_v$` hoisting shapes (Babel's `Scope.push` IIFE
// parameter fast path). Each case compiles with both compilers in every mode
// and the normalized outputs must be identical — there is no ratchet here;
// divergence is always a failure.

const { modes, compileBabel, compileOxc, normalize, unifiedDiff } = require("./parity/harness");

const cases = {
  "two-level attribute nesting": `
const a = <div a={<span b={<b>{x()}</b>}>{y()}</span>} />;
const z = <p>P</p>;
`,
  "attribute JSX inside component prop JSX": `
const a = <Comp p={<div q={<span>{s()}</span>} />} />;
const z = <p>P</p>;
`,
  "this tags in deferred positions": `
class A {
  m() {
    return <div title={<this.Tip />}><Comp c={<this.another />} d={this.value} /></div>;
  }
}
`,
  "handler JSX inside component prop": `
const a = <Comp p={<button onClick={() => open(<div>{x()}</div>)}>go</button>} />;
const z = <p>P</p>;
`,
  "fragment in attribute": `
const a = <div a={<><span>{x()}</span><b>B</b></>} />;
const z = <p>P</p>;
`,
  "conditional JSX in attribute": `
const a = <div a={cond() ? <b>{x()}</b> : <i>I</i>} />;
const z = <p>P</p>;
`,
  "cross-statement template ordering": `
const a = <div a={<span>{x()}</span>} />;
const b = <section b={<em>{y()}</em>} />;
const c = <p>P</p>;
`,
  "spread object getter": `
const a = <div {...{ get a() { return <span>{x()}</span>; } }} />;
const z = <p>P</p>;
`,
  "component spread plus attribute JSX": `
const a = <Comp {...obj} a={<b>{x()}</b>} />;
const z = <p>P</p>;
`,
  "arrow variable root": `
const f = () => <div a={<span>{x()}</span>} />;
const z = <p>P</p>;
`,
  "ref appending JSX": `
const a = <div ref={el => el.append(<span>{x()}</span>)} />;
const z = <p>P</p>;
`,
  "IIFE in attribute": `
const a = <div a={(() => <span>{x()}</span>)()} />;
const z = <p>P</p>;
`,
  "block IIFE in attribute": `
const a = <div a={(() => { return <span>{x()}</span>; })()} />;
const z = <p>P</p>;
`,
  "component children with attribute JSX": `
const a = <Comp><div a={<span>{x()}</span>} /></Comp>;
const z = <p>P</p>;
`,
  "this expressions in nested attribute JSX": `
class B {
  m() {
    return <div title={this.title} data={<span>{this.x}</span>} />;
  }
}
`,
  "getter body statement JSX in prop": `
const a = <Comp p={(() => { const el = <div>{x()}</div>; return el; })()} />;
const z = <p>P</p>;
`,
  "this inside nested plain function stays raw": `
class A {
  m() {
    return <div onClick={function () { return this.x; }} a={this.y} />;
  }
}
`,
  "this-tag inside nested plain function": `
class A {
  m() {
    return <Comp p={function () { return <this.Tag />; }} q={this.q} />;
  }
}
`,
  "object method this in spread": `
class A {
  m() {
    return <div {...{ m() { return this.x; }, n: this.n }} />;
  }
}
`,
  "top level this": `
const a = <div a={this.x}>{this.y}</div>;
`,
  "capture with preceding statements": `
class A {
  m() {
    const k = compute();
    doSomething(k);
    return <div a={this.b}>{k}</div>;
  }
}
`,
  "capture in plain function with preceding statements": `
function f() {
  doStuff();
  return <div a={this.x} />;
}
`,
  "capture in private class method": `
class A {
  #m() {
    doStuff();
    return <div a={this.x} />;
  }
}
`,
  "fragment root with this": `
class A {
  m() {
    return <><div a={this.x} /><span>{this.y}</span></>;
  }
}
`,
  "this in class field JSX": `
class A {
  view = <div a={this.x}>{this.y}</div>;
  fn = () => <div b={this.z} />;
}
`,
  "IIFE with args in attribute": `
const a = <div a={(v => <span>{v()}</span>)(x)} />;
const z = <p>P</p>;
`,
  "named function IIFE in attribute": `
const a = <div a={(function go() { return <span>{x()}</span>; })()} />;
const z = <p>P</p>;
`,
  "expression-position JSX in ternary": `
const a = cond() ? <div a={<span>{x()}</span>} /> : null;
const z = <p>P</p>;
`,
  "component in arrow expression prop": `
const a = <Comp render={() => <div a={<b>{x()}</b>} />} />;
const z = <p>P</p>;
`,
  // Round 2: statement structures, refs, events, namespaces, text escaping,
  // components, and SSR-specific paths (var scoping, attribute passthrough).
  "export const with JSX init": `
export const view = <div>{x()}</div>;
export const plain = <p>P</p>;
`,
  "export default JSX": `
export default <div>{x()}</div>;
`,
  "export function returning JSX": `
export function App() {
  return <div>{x()}</div>;
}
`,
  "multiple declarators with JSX": `
const a = <div>{x()}</div>, b = <p>{y()}</p>;
`,
  "JSX in switch case": `
function f(k) {
  switch (k) {
    case 1:
      return <div>{x()}</div>;
    default: {
      const el = <p>{y()}</p>;
      return el;
    }
  }
}
`,
  "JSX in try catch": `
function f() {
  try {
    return <div>{x()}</div>;
  } catch (e) {
    return <p>{String(e)}</p>;
  }
}
`,
  "JSX nested in if blocks with this": `
class A {
  m() {
    if (cond()) {
      return <div a={this.x}>{this.y}</div>;
    }
    return null;
  }
}
`,
  "JSX in for-of body": `
function f(items) {
  const out = [];
  for (const item of items) {
    out.push(<div>{item}</div>);
  }
  return out;
}
`,
  "JSX in default parameter": `
function f(el = <div>{x()}</div>) {
  return el;
}
`,
  "JSX in class static block": `
class A {
  static {
    this.template = <div>{x()}</div>;
  }
}
`,
  "JSX in template literal": `
const s = html\`\${<div>{x()}</div>}\`;
const z = <p>P</p>;
`,
  "arrow sequence body": `
const f = () => (log(), <div>{x()}</div>);
`,
  "ref let binding": `
let r;
const a = <div ref={r}>{x()}</div>;
`,
  "ref const function binding": `
const r = el => save(el);
const a = <div ref={r}>{x()}</div>;
`,
  "ref undeclared identifier": `
const a = <div ref={someRef}>{x()}</div>;
`,
  "ref member expression": `
const a = <div ref={obj.el}>{x()}</div>;
`,
  "ref this member in method": `
class A {
  m() {
    return <div ref={this.el}>{this.x}</div>;
  }
}
`,
  "component ref forwarding": `
let r;
const a = <Comp ref={r}>{x()}</Comp>;
`,
  "bound event array": `
const a = <button onClick={[handler, data()]}>go</button>;
`,
  "on namespace event": `
const a = <div on:custom-thing={handler} oncapture:click={capture} />;
`,
  "lowercase and camel events": `
const a = <div onclick={h1} onDblClick={h2} onMouseMove={move()} />;
`,
  "class and style namespaces": `
const a = <div class:active={isActive()} style:color={color()} />;
`,
  "prop attr bool namespaces": `
const a = <div prop:value={v()} attr:data-x={d()} bool:hidden={h()} />;
`,
  "use directive": `
const a = <div use:tooltip={[text(), placement]} use:other />;
`,
  "classList object": `
const a = <div classList={{ active: active(), "is-big": big, static: true }} />;
`,
  "style object mixed": `
const a = <div style={{ color: c(), "background-color": "red", "--theme": t() }} />;
`,
  "innerHTML and textContent": `
const a = <div innerHTML={html()} />;
const b = <span textContent={text()} />;
`,
  "class merge with spread": `
const a = <div class="base" {...props()} classList={{ hot: hot() }} />;
`,
  "controlled input": `
const a = <input value={v()} onInput={onIn} checked={c()} />;
`,
  "template escaping backtick dollar": `
const a = <div title={"\`"}>{"\`"}text with \` and {"$"}{"{"}notinterp{"}"} end</div>;
const b = <pre>{"line1"}
  raw \` backtick and $\{fake} interp
</pre>;
`,
  "html entities": `
const a = <div title="a&amp;b &lt;c&gt; &quot;d&quot;">&nbsp;&lt;tag&gt; &amp;&amp; &#169; text</div>;
`,
  "comment only child": `
const a = <div>{/* just a comment */}</div>;
const b = <div>{ }</div>;
`,
  "whitespace and newline handling": `
const a = (
  <div>
    {first()}
    {second()}
    text between
    {third()}
  </div>
);
`,
  "deep member component": `
const a = <mod.ns.Comp x={v()}>{x()}</mod.ns.Comp>;
`,
  "builtins with function children": `
const a = (
  <For each={list()}>
    {(item, i) => <div data-i={i()}>{item.name}</div>}
  </For>
);
const b = <Show when={cond()} fallback={<p>none</p>}><span>{x()}</span></Show>;
`,
  "component multiple spreads and children": `
const a = <Comp {...one} b={x()} {...two} c="s"><div>{y()}</div></Comp>;
`,
  "custom element dynamic props": `
const a = <my-element level={lvl()} static="yes" onCustom={h}>{x()}</my-element>;
`,
  "textarea select values": `
const a = <textarea value={v()} />;
const b = (
  <select value={sel()}>
    <option value="1">one</option>
    <option value={two()}>two</option>
  </select>
);
`,
  "dynamic boolean attributes": `
const a = <input disabled={d()} readonly={r()} required />;
`,
  "assignment expression JSX": `
let view;
view = <div>{x()}</div>;
const z = <p>P</p>;
`,
  "JSX as call arguments": `
render(<div>{x()}</div>, <p>P</p>);
`,
  "JSX in array and object literals": `
const list = [<div>{x()}</div>, <p>P</p>];
const map = { a: <span>{y()}</span> };
`,
  // Round 3: SVG/MathML, raw text elements, async/generator contexts, class
  // accessors, exotic hole values, builtins, static markers, escaping edge
  // cases, and dynamic-mode renderer boundaries (where both compilers must
  // reject cross-renderer native nesting).
  "svg with dynamic attributes": `
const a = (
  <svg viewBox="0 0 100 100" fill={f()}>
    <circle cx={x()} cy="50" r="10" />
    <use href="#icon" />
  </svg>
);
`,
  "svg inside div": `
const a = <div><svg width="16"><path d={d()} /></svg>{label()}</div>;
`,
  "foreignObject boundary": `
const a = (
  <svg>
    <foreignObject>
      <div class={c()}>{x()}</div>
    </foreignObject>
  </svg>
);
`,
  "mathml element": `
const a = <math><mi>{sym()}</mi><mn>2</mn></math>;
`,
  "xmlns and xml attributes": `
const a = <svg xmlns="http://www.w3.org/2000/svg" xml:lang="en"><text>{t()}</text></svg>;
`,
  "script tag raw text": `
const a = <script type="module">{code()}</script>;
const b = <style>{css()}</style>;
`,
  "async function with JSX": `
async function load() {
  const data = await fetchData();
  return <div>{data.name}</div>;
}
`,
  "generator with JSX": `
function* gen() {
  yield <div>{x()}</div>;
  yield <p>P</p>;
}
`,
  "class getter returning JSX": `
class A {
  get view() {
    return <div a={this.x}>{this.y}</div>;
  }
  set view(v) {
    this.el = <span>{v}</span>;
  }
}
`,
  "optional chaining in holes and refs": `
const a = <div ref={obj?.el} title={opts?.title}>{data?.items?.length}</div>;
`,
  "nullish coalescing hole": `
const a = <div>{value() ?? "fallback"}</div>;
`,
  "exotic literal holes": `
const a = <div a={1n} b={/re?g/g} c={-1} d={NaN}>{0}{-0}{1n}{true}{undefined}{null}</div>;
`,
  "tagged template in hole": `
const a = <div title={tag\`x \${y()}\`}>{tag\`body\`}</div>;
`,
  "sequence and assignment holes": `
let s;
const a = <div title={(log(), t())} onClick={() => (s = 1)}>{(a1(), a2())}</div>;
`,
  "static marker on expressions": `
const a = <div title={/*@static*/ t()}>{/*@static*/ text()}</div>;
`,
  "portal builtin": `
const a = <Portal mount={document.body}><div>{x()}</div></Portal>;
`,
  "dynamic component builtin": `
const a = <Dynamic component={comp()} someProp={p()}>{x()}</Dynamic>;
`,
  "ErrorBoundary and Suspense": `
const a = (
  <ErrorBoundary fallback={err => <pre>{err.message}</pre>}>
    <Suspense fallback={<p>loading</p>}>
      <div>{x()}</div>
    </Suspense>
  </ErrorBoundary>
);
`,
  "component lowercase member": `
const a = <views.item thing={t()}>{x()}</views.item>;
`,
  "quotes in static attributes": `
const a = <div title='has "double" quotes' data-x={'mixed "q" and \\'sq\\''}>{x()}</div>;
`,
  "unicode and emoji text": `
const a = <div title="héllo 🌍">ünïcode 🎉 text {x()} 中文</div>;
`,
  "numeric and boolean static attributes": `
const a = <input tabindex={3} maxlength={10} autofocus={true} disabled={false} />;
const b = <td colspan={2}>{x()}</td>;
`,
  "textarea with children": `
const a = <textarea>{content()}</textarea>;
const b = <textarea placeholder={p()}>static text</textarea>;
`,
  "iframe and img attributes": `
const a = <iframe src={src()} loading="lazy" />;
const b = <img src={s()} alt="" width={w()} />;
`,
  "label for and html for": `
const a = <label for={id()} class="lbl">{text()}</label>;
`,
  "aria and data dynamic": `
const a = <div aria-label={l()} aria-hidden="true" data-count={c()} data-static="s">{x()}</div>;
`,
  "spread only element": `
const a = <div {...props()} />;
const b = <span {...one} {...two()} />;
`,
  "spread with events and refs": `
const a = <div {...props} onClick={click} ref={r} class={c()}>{x()}</div>;
`,
  "conditional attribute chains": `
const a = <div class={cond() ? "a" : cond2() ? "b" : "c"} title={x() && y() || z()}>{t()}</div>;
`,
  "nested ternary children": `
const a = <div>{cond() ? <b>{x()}</b> : other() ? <i>{y()}</i> : <u>u</u>}</div>;
`,
  "logical chains children": `
const a = <div>{cond() && <b>{x()}</b>}{other() || <i>fallback</i>}</div>;
`,
  "keyed show pattern": `
const a = (
  <Show when={user()} keyed fallback={<p>anon</p>}>
    {u => <div>{u.name}</div>}
  </Show>
);
`,
  "labeled statement JSX": `
function f() {
  outer: {
    const el = <div>{x()}</div>;
    if (skip()) break outer;
    return el;
  }
  return null;
}
`,
  "do while with JSX": `
function f() {
  const out = [];
  do {
    out.push(<div>{x()}</div>);
  } while (more());
  return out;
}
`,
  "JSX in computed property and key": `
const o = { [key()]: <div>{x()}</div> };
const b = <div data-k={o[<i>i</i>] ?? "n"} />;
`,
  "new expression holes": `
const a = <div title={new Date().toISOString()}>{new Intl.NumberFormat().format(n())}</div>;
`,
  "immediately invoked arrow with jsx arg": `
const a = (el => el)(<div>{x()}</div>);
const z = <p>P</p>;
`,
  "conditional spread": `
const a = <div {...(cond() ? one : two)}>{x()}</div>;
`,
  "value and checked properties": `
const a = <input value={v()} checked={c()} type="checkbox" />;
const b = <progress value={p()} max="100" />;
`,
  "contenteditable and dir": `
const a = <div contenteditable={ce()} dir="rtl" spellcheck={false}>{x()}</div>;
`,
  "void elements with attributes": `
const a = <div><br/><hr class={c()}/><input type="text" value={v()}/><meta charset="utf-8"/></div>;
`,
  "void elements discard children": `
const a = <input>{value()}</input>;
const b = <br>text</br>;
`,

  // Round 4: generated-uid collisions with user code, whitespace idioms,
  // child-property/children conflicts, duplicate attributes, stateful DOM
  // properties, aliases, enumerated attributes, typeof folding, fragments,
  // odd expression positions, and SSR escaping corners.
  "uid collision el and tmpl": `
const _el$ = getEl();
const _tmpl$ = "user template";
const a = <div title={_el$}>{_tmpl$}</div>;
const b = <p>P</p>;
`,
  "uid collision v and self": `
class A {
  m() {
    const _self$ = "mine";
    const _v$ = 3;
    return <div a={this.x} b={_v$}>{_self$}</div>;
  }
}
`,
  "explicit space idiom": `
const a = <div>{first()}{" "}{second()}</div>;
const b = <span>a{" "}b</span>;
`,
  "newline and tab strings": `
const a = <pre>{"line1\\n"}{"\\t"}indent{x()}</pre>;
`,
  "innerHTML with real children": `
const a = <div innerHTML={html()}>fallback text</div>;
`,
  "textContent with real children": `
const a = <div textContent={t()}><span>kid</span></div>;
`,
  "innerHTML static string": `
const a = <div innerHTML={"<b>bold</b>"} />;
`,
  "duplicate attributes": `
const a = <div class="one" class="two" title={t1()} title={t2()}>{x()}</div>;
`,
  "duplicate children attributes": `
const a = <div children={a()} children={b()} />;
`,
  "children attribute before spread": `
const a = <div children={fallback()} {...props} />;
`,
  "children attribute after spread": `
const a = <div {...props} children={later()} />;
`,
  "static children attribute": `
const a = <div children="hello" />;
`,
  "foldable children attribute": `
const child = "hello";
const a = <div children={child} />;
`,
  "children attribute with real children": `
const a = <div children={fallback()}>keep</div>;
`,
  "prop namespace after spread": `
const a = <div {...props} prop:custom={value()} />;
`,
  "known prop namespace after spread": `
const a = <input {...props} prop:value={value()} />;
const b = <input {...props} prop:defaultValue={defaultValue()} />;
`,
  "stateful property aliases use last value": `
const a = <input value={first()} prop:value={last()} />;
const b = <input prop:value={first()} value={last()} />;
const c = <input defaultValue={first()} prop:defaultValue={last()} />;
const d = <input prop:defaultValue={first()} defaultValue={last()} />;
`,
  "duplicate refs": `
const a = <div ref={r1} ref={r2}>{x()}</div>;
`,
  "select with value": `
const a = (
  <select multiple value={vals()}>
    <option selected={s()} value="a">A</option>
  </select>
);
`,
  "media stateful props": `
const a = <video muted={m()} autoplay={ap()} playsinline src={src()} />;
const b = <audio volume={v()} />;
`,
  "attribute aliases": `
const a = <label htmlFor={f()} tabIndex={ti()} colSpan={cs()} className={cn()}>{x()}</label>;
`,
  "enumerated attributes": `
const a = <div draggable={d()} spellcheck={sp()} autocapitalize="off">{x()}</div>;
`,
  "typeof and void holes": `
const a = <div a={typeof 1} b={void 0}>{typeof "s"}{void 0}</div>;
`,
  "empty and whitespace fragments": `
const a = <></>;
const b = <>   </>;
const c = <>
</>;
const z = <p>P</p>;
`,
  "nested fragments": `
const a = <><><b>{x()}</b></><i>I</i></>;
`,
  "fragment single expression": `
const a = <>{x()}</>;
const b = <>{"static"}</>;
`,
  "fragment of components": `
const a = <><Comp1/><Comp2>{x()}</Comp2></>;
`,
  "jsx in if condition": `
function f() {
  if (check(<div>{x()}</div>)) return 1;
  return 0;
}
`,
  "map arrow returning jsx": `
function f(items) {
  return items.map(item => <li data-id={item.id}>{item.name}</li>);
}
`,
  "pure row expression arrow (rowProof stamps)": `
const row = r => <li class={r.done ? "done" : ""} onClick={() => pick(r.id)} textContent={r.name} />;
`,
  "pure row return-only block arrow (rowProof stamps)": `
const row = r => { return <li textContent={r.name} />; };
`,
  "pure row function expression (rowProof stamps)": `
const row = function (r) { return <li textContent={r.name} />; };
`,
  "row with user statement declines rowProof": `
const row = r => { doWork(r); return <li textContent={r.name} />; };
`,
  "row with ref declines rowProof": `
const row = r => <li ref={r.el} textContent={r.name} />;
`,
  "row with insert hole declines rowProof": `
const row = r => <li>{r.name}</li>;
`,
  "foreign-subject row declines rowProof": `
const outer = getStore();
const row = r => <li textContent={outer.title} />;
`,
  "reassigned subject declines patch mode": `
let subject = first();
subject = second();
const view = <li textContent={subject.name} />;
`,
  "component member expression props": `
const a = <Comp a={obj.prop} b={obj[key()]} c={obj?.maybe} d={fn.call} />;
`,
  "component namespaced prop": `
const a = <Comp ns:x={v()} plain={p} stat="s" ns:y="lit" />;
`,
  "component boolean shorthand": `
const a = <Comp flag another={true}>{x()}</Comp>;
`,
  "custom element props and events": `
const a = <my-el prop:custom={c()} attr:plain={p()} onSomething={h} value={v()}>{x()}</my-el>;
`,
  "slot element": `
const a = <slot name={n()}>{fallback()}</slot>;
`,
  "conditional chains with jsx": `
const a = <div>{cond() && other() && <b>{x()}</b>}</div>;
const b = <div>{cond() ? <b>B</b> : null}</div>;
const c = <div>{!cond() ? <i>I</i> : <u>U</u>}</div>;
`,
  "memoized ternary in prop": `
const a = <Comp choice={cond() ? heavy1() : heavy2()} static={flag ? "a" : "b"} />;
`,
  "ssr escaping corners": `
const a = <div title={"a & b < c"}>{"<script>alert(1)</script>"} &amp; raw {amp()}</div>;
`,
  "script with closing tag text": `
const a = <script>{"if (a < b) { run(\\"</\\" + \\"script>\\"); }"}</script>;
`,
  "empty attribute values": `
const a = <div title="" class="" data-x={""}>{x()}</div>;
`,
  "template literal class attribute": `
const a = <div class={\`base \${extra()}\`}>{x()}</div>;
const b = <div class={\`all-static\`} />;
`,
  "table structure": `
const a = (
  <table>
    <thead><tr><th>H</th></tr></thead>
    <tbody>
      <tr><td>{cell()}</td><td colspan={2}>static</td></tr>
    </tbody>
  </table>
);
`,
  "td root element": `
const a = <td>{x()}</td>;
const b = <tr><td>T</td></tr>;
`,
  "deeply nested dynamic": `
const a = (
  <div>
    <section>
      <article>
        <header>{title()}</header>
        <p>body {text()} end</p>
      </article>
    </section>
  </div>
);
`,
  "sibling components no anchors": `
const a = <div><Comp1/><Comp2/><Comp3/></div>;
`,
  "mixed component element runs": `
const a = <div><Comp1/><span>S</span><Comp2/>text<Comp3/></div>;
`,

  // --- Round 5: builtIns scope resolution, template dedup, statement-position
  // exotics, TS-syntax rejection parity -------------------------------------
  "unbound For builtin": `
const a = <For each={items()}>{item => <li>{item}</li>}</For>;
`,
  "unbound Show with fallback": `
const a = <Show when={cond()} fallback={<span>no</span>}><div>{x()}</div></Show>;
`,
  "unbound builtin no other output": `
const a = <Show when={c()}>{x()}</Show>;
`,
  "shadowed builtin import": `
import { For } from "./custom";
const a = <For each={items()}>{item => <li>{item}</li>}</For>;
`,
  "shadowed builtin local": `
const Show = MyShow;
const a = <Show when={c()}>{x()}</Show>;
`,
  "builtin shadowed by declaration after use": `
const a = <Show when={c()}>{x()}</Show>;
const Show = MyShow;
`,
  "builtin shadowed by import after use": `
const a = <Show when={c()}>{x()}</Show>;
import { Show } from "./mine";
`,
  "builtin shadowed by function declaration after use": `
const a = <For each={i()}>{v => <li>{v}</li>}</For>;
function For() {}
`,
  "builtin shadowed by function param": `
function f(For) {
  return <For each={items()}>{item => <li>{item}</li>}</For>;
}
const z = <p>P</p>;
`,
  "builtin shadowed by destructured param": `
function f({ For }) {
  return <For each={i()}>{v => <li>{v}</li>}</For>;
}
const z = <p>P</p>;
`,
  "builtin shadowed by arrow param": `
const f = Show => <Show when={c()}>{x()}</Show>;
const z = <p>P</p>;
`,
  "builtin shadowed by loop head": `
function f(list) {
  for (const For of list) {
    push(<For each={i()} />);
  }
  return <For each={i()} />;
}
`,
  "builtin not shadowed by sibling function param": `
function a(For) {
  return null;
}
const b = <For each={i()}>{v => <li>{v}</li>}</For>;
`,
  "builtin not shadowed by inner block let": `
function f() {
  {
    let For = X;
  }
  return <For each={i()}>{v => <li>{v}</li>}</For>;
}
`,
  "builtin not shadowed by catch param": `
try {
  g();
} catch (Show) {}
const a = <Show when={c()}>{x()}</Show>;
`,
  "builtin nested in builtin": `
const a = <Show when={c()}><For each={i()}>{v => <li>{v}</li>}</For></Show>;
`,
  "builtin under native element": `
const a = <ul><For each={items()}>{item => <li>{item}</li>}</For></ul>;
`,
  "member expression tag not builtin": `
const a = <For.Item each={items()}>{item => <li>{item}</li>}</For.Item>;
`,
  "ts non-null ref rejected": `
const a = <div ref={el!} />;
`,
  "ts as expression rejected": `
const a = <Comp p={x as any} />;
`,
  "template dedup identical roots": `
const a = <div><span>hi</span></div>;
const b = <div><span>hi</span></div>;
const c = <div><span>other</span></div>;
`,
  "template dedup with dynamic holes": `
const a = <div>start {x()} end</div>;
const b = <div>start {y()} end</div>;
`,
  "svg and html same markup": `
const a = <svg><text>label</text></svg>;
const b = <text>label</text>;
`,
  "export default jsx": `
export default <div>{x()}</div>;
`,
  "export default function returning jsx": `
export default function App() {
  return <div>{x()}</div>;
}
`,
  "jsx in try catch finally": `
function f() {
  try {
    mount(<div>{a()}</div>);
  } catch (err) {
    mount(<span>{err.message}</span>);
  } finally {
    mount(<i>done</i>);
  }
}
`,
  "jsx in switch case": `
function f(kind) {
  switch (kind) {
    case 1: {
      const a = <div>{x()}</div>;
      return a;
    }
    default:
      return <span>fallback</span>;
  }
}
`,
  "jsx in single-statement loop bodies": `
function f(items) {
  const out = [];
  for (const item of items) out.push(<li>{item}</li>);
  let i = 0;
  while (i < 3) {
    out.push(<span>{i++}</span>);
  }
  return out;
}
`,
  "jsx in class static block": `
class A {
  static {
    this.view = <div>{x()}</div>;
  }
}
`,
  "jsx in arrow default param": `
const f = (a = <div>{x()}</div>) => a;
const z = <p>P</p>;
`,
  "throw jsx": `
function f() {
  throw <div>error {x()}</div>;
}
`,
  "yield jsx in generator": `
function* g() {
  yield <div>{x()}</div>;
  yield* others();
}
`,
  "jsx in template literal hole": `
const s = \`before \${<div>{x()}</div>} after\`;
const z = <p>P</p>;
`,
  "sequence expression jsx": `
const a = (log(), <div>{x()}</div>);
`,
  "labeled block jsx": `
out: {
  const a = <div>{x()}</div>;
}
`,
  "jsx in object and array literals": `
const cfg = {
  view: <div>{x()}</div>,
  list: [<li>a</li>, <li>{b()}</li>]
};
`,
  "assignment expression jsx": `
let v;
v = <div>{x()}</div>;
`,
  "jsx in new expression arg": `
const w = new Wrapper(<div>{x()}</div>);
`,
  "comments between attributes": `
const a = <div /*c1*/ title={t()} /*c2*/ class="a">{x()}</div>;
`,
  "deeply parenthesized jsx": `
const a = (((<div>{x()}</div>)));
`,

  // --- Round 6: scope-aware binding classification. Identifier
  // classifications (const refs, resolvable event handlers, static value
  // inlining, namespace imports) must resolve against the live scope chain:
  // bindings from an earlier, already-closed sibling scope must not leak,
  // and inner declarations must shadow outer ones. ---------------------------
  "ref stale const in closed sibling scope": `
describe("first", () => {
  const div = document.createElement("div");
});
describe("second", () => {
  let div;
  const Component = () => <div ref={div}>a</div>;
});
`,
  "ref stale literal in closed sibling scope": `
describe("first", () => {
  const div = 1;
});
describe("second", () => {
  let div;
  const Component = () => <div ref={div}>a</div>;
});
`,
  "ref let scope before sibling const scope": `
describe("second", () => {
  let div;
  const Component = () => <div ref={div}>a</div>;
});
describe("first", () => {
  const div = document.createElement("div");
});
`,
  "ref const after let scope": `
describe("second", () => {
  let div;
  const Component = () => <div ref={div}>a</div>;
});
const div = document.createElement("div");
`,
  "ref let shadowing outer const": `
const div = document.createElement("div");
function outer() {
  let div;
  return <div ref={div}>a</div>;
}
`,
  "ref const shadowing outer let": `
let r;
function outer() {
  const r = el => save(el);
  return <div ref={r}>a</div>;
}
`,
  "component ref stale const in closed sibling scope": `
describe("first", () => {
  const r = el => save(el);
});
describe("second", () => {
  let r;
  const Component = () => <Comp ref={r}>a</Comp>;
});
`,
  "event handler stale function in closed sibling scope": `
describe("first", () => {
  const handler = () => {};
});
describe("second", () => {
  let handler;
  const Component = () => <div onClick={handler}>a</div>;
});
`,
  "static string stale in closed sibling scope": `
describe("first", () => {
  const title = "stale";
  const msg = "hello";
});
describe("second", () => {
  let title;
  let msg;
  const Component = () => <div title={title}>{msg}</div>;
});
`,
  "static bool stale in closed sibling scope": `
describe("first", () => {
  const draggable = true;
});
describe("second", () => {
  let draggable;
  const Component = () => <div draggable={draggable}>a</div>;
});
`,
  "style static stale in closed sibling scope": `
describe("first", () => {
  const color = "red";
});
describe("second", () => {
  let color;
  const Component = () => <div style={{ color }}>a</div>;
});
`,
  "classList stale const in closed sibling scope": `
describe("first", () => {
  const active = true;
});
describe("second", () => {
  let active;
  const Component = () => <div classList={{ active }}>a</div>;
});
`,
  "component spread namespace shadowed by local": `
import * as ns from "x";
function f() {
  let ns;
  return <Comp {...ns.props}>a</Comp>;
}
`,
  "var hoisted out of block keeps classification": `
function f() {
  {
    var handler = () => {};
    var title = "static";
  }
  return <div onClick={handler} title={title}>a</div>;
}
`,
  "stale block let does not leak to sibling block": `
function f() {
  {
    const div = 1;
  }
  {
    let div;
    return <div ref={div}>a</div>;
  }
}
`,

  // --- Round 7: fragments as component children (dom mode used to reject
  // these outright while babel and ssr accepted them). Sole fragment child
  // vs mixed with siblings, static/dynamic/element content, nesting, keyed
  // components, conditionals, and fragments in non-children props. ----------
  "fragment component child with expression": `
const a = <Show when={cond()}><>{props.children}</></Show>;
`,
  "fragment component child with text": `
const a = <Show><>text</></Show>;
`,
  "fragment component child with element": `
const a = <Show><><div /></></Show>;
`,
  "fragment component child with multiple elements": `
const a = <Show><><div /><span /></></Show>;
`,
  "fragment component child with dynamic element child": `
const a = <Show><><div>{x()}</div></></Show>;
`,
  "fragment component child mixed with siblings": `
const a = <Show><p>P</p><>{x()}<div /></><p>P</p></Show>;
`,
  "nested fragment component child": `
const a = <Show><><><div />{x()}</></></Show>;
`,
  "empty fragment component child": `
const a = <Show><></></Show>;
`,
  "keyed fragment component child": `
const a = <Show when={item()} keyed><>{x()}<div /></></Show>;
`,
  "fragment component child with conditional": `
const a = <Show><>{cond() ? <div /> : x()}</></Show>;
`,
  "fragment component child with ref element": `
let r;
const a = <Show><><div ref={r}>{x()}</div></></Show>;
`,
  "fragment in non-children component prop": `
const a = <Show thing={<><div /><span /></>} />;
`,

  // --- Round 8: one isDynamic authority. Babel's isDynamic combines the
  // /*@static*/ leading-comment check, the namespace-import member carve-out,
  // and the deep traversal in a single function that every mode consults;
  // the port had split it into fragments reassembled differently per call
  // site, so dom/universal misclassified namespace-import members (extra
  // thunks/getters/effects where Babel emits static values), dom ignored
  // static markers in fragment and component children, span-based marker
  // scanning made trailing comments (`{a() /*@static*/}`) wrongly static,
  // and transformCondition's branch probes missed the carve-out in every
  // mode. -------------------------------------------------------------------
  "ns import member element child": `
import * as styles from "./m";
const a = <div>{styles.button}</div>;
`,
  "ns import member fragment child": `
import * as styles from "./m";
const a = <>{styles.button}</>;
`,
  "ns import member component child": `
import * as styles from "./m";
const a = <Comp>{styles.button}</Comp>;
`,
  "ns import member component prop": `
import * as ns from "./m";
const a = <Comp p={ns.value} />;
`,
  "ns import member element attribute": `
import * as ns from "./m";
const a = <div title={ns.x}>{y()}</div>;
`,
  "ns import computed member static key": `
import * as ns from "./m";
const a = <div>{ns["key"]}</div>;
`,
  "ns import computed member dynamic key": `
import * as ns from "./m";
const a = <div>{ns[key()]}</div>;
`,
  "ns import optional member child": `
import * as ns from "./m";
const a = <div>{ns?.x}</div>;
`,
  "ns import member nested in expression": `
import * as ns from "./m";
const a = <div>{[ns.x]}</div>;
`,
  "ns import spread on component": `
import * as ns from "./m";
const a = <Comp {...ns.props} />;
`,
  "ns import spread on element": `
import * as ns from "./m";
const a = <div {...ns.props} />;
`,
  "ns import member in conditional branches": `
import * as ns from "./m";
const a = <div>{cond() ? ns.a : ns.b}</div>;
`,
  "static marker fragment child": `
const a = <>{/*@static*/ a()}</>;
`,
  "static marker component child": `
const a = <Comp>{/*@static*/ a()}</Comp>;
`,
  "static marker component children multi": `
const a = <Comp>{/*@static*/ a()}{b()}</Comp>;
`,
  "static marker trailing comment stays dynamic": `
const a = <div>{a() /*@static*/}</div>;
`,
  "static marker trailing in component prop": `
const a = <Comp p={state.x /*@static*/} />;
`,
  "static marker in condition branch": `
const a = <div>{cond() ? /*@static*/ x() : y()}</div>;
`,

  // --- Round 9: spread children through the unified classifier. Babel's
  // JSXSpreadChild handling is one transformNode branch (dynamic spreads
  // become an explicit thunk, memo-wrapped in fragment position, inserted
  // raw when static); the dom port rejected fragment spreads outright and
  // keyed element spreads off expression shape, while universal emitted
  // dynamic fragment spreads raw, silently losing reactivity. ---------------
  "fragment spread child dynamic": `
const a = <>{...items()}</>;
`,
  "fragment spread child static": `
const a = <>{...items}</>;
`,
  "fragment spread child mixed siblings": `
const a = <><span>s</span>{...items()}</>;
`,
  "fragment spread child ns import member": `
import * as ns from "./m";
const a = <>{...ns.list}</>;
`,
  "element spread child dynamic": `
const a = <div>{...items()}</div>;
`,
  "element spread child static": `
const a = <div>{...items}</div>;
`,
  "component spread child dynamic": `
const a = <Comp>{...items()}</Comp>;
`,
  "spread child marker ignored (attaches to spread, not expression)": `
const a = <>{/*@static*/ ...items()}</>;
`,
  "element spread child with nested jsx classifies on the original": `
const a = <div>{...[<span/>]}</div>;
`,

  // --- Round 10: the component prop loop through the unified lowering.
  // Babel's transformComponent is one function; the universal port's copy
  // eagerly visited spread arguments before classifying them, so JSX inside
  // a spread read as dynamic and grew a spurious mergeProps thunk. ----------
  "jsx inside component spread arg": `
const a = <Comp {...{ a: <div>hi</div> }} />;
`,
  "dynamic component spread forces merge": `
const a = <Comp {...props()} other={1} />;
`,
  "static component spread passes through": `
const obj = {};
const a = <Comp {...obj} />;
`,
  "component prop inline condition": `
const a = <Comp when={a() ? <b /> : <c />} />;
`,
  "component ref call value": `
const a = <Comp ref={getRef()} />;
`,
  "component namespace member prop": `
import * as styles from "./s.css";
const a = <Comp class={styles.button} />;
`
};

describe("Babel vs Oxc parity probes", () => {
  for (const mode of Object.keys(modes)) {
    describe(mode, () => {
      test.each(Object.keys(cases))("%s", name => {
        const source = cases[name];
        const options = modes[mode].options;
        // Some inputs must *fail* in some modes (e.g. cross-renderer native
        // nesting in dynamic mode); both compilers rejecting is parity too.
        let babelOut, babelError;
        try {
          babelOut = normalize(compileBabel(source, options));
        } catch (err) {
          babelError = err;
        }
        let oxcOut, oxcError;
        try {
          oxcOut = normalize(compileOxc(source, "probe", options));
        } catch (err) {
          oxcError = err;
        }
        if (babelError || oxcError) {
          if (babelError && oxcError) return;
          const [which, error] = babelError ? ["babel", babelError] : ["oxc", oxcError];
          throw new Error(
            `${mode}/${name}: only ${which} threw (${error.message.split("\n")[0]}); ` +
              "the other compiler accepted the input."
          );
        }
        if (babelOut !== oxcOut) {
          throw new Error(
            `${mode}/${name} diverges (normalized diff below, babel = "-", oxc = "+").\n` +
              unifiedDiff(babelOut, oxcOut)
          );
        }
      });
    });
  }
});
