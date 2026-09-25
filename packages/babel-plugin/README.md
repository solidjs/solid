# @solidjs/babel-plugin

Solid 2.0's Babel compiler integration. Configure this plugin once in a Babel pipeline; its current syntax frontend lowers JSX to template clones, inserts, and reactive wrappers against `@solidjs/web` (or a custom renderer).

The native Oxc compiler — [`@solidjs/compiler`](../compiler) — is the default in `vite-plugin-solid`. Use this plugin when you need a Babel pipeline (or as the JavaScript fallback).

> **Solid 2.0 (Release Candidate).** Pin exact versions.

## Features

Lowercase tags are HTML elements; mixed-case tags are components. The plugin supports Custom Elements, camelCase event handlers, DOM-safe attributes (`class`, `for`), `ref`, and object `style` / `class` parsing.

Attribute expressions are attributes by default, except on custom elements (properties) and special fields like `class` and `style`. A heuristic wraps expressions that contain function calls or property access; simple literals and variables stay unwrapped.

## Example

```jsx
const view = ({ item }) => {
  const itemId = item.id;
  return (
    <tr class={itemId === selected() ? "danger" : ""}>
      <td class="col-md-1">{itemId}</td>
      <td class="col-md-4">
        <a onClick={e => select(item, e)}>{item.label}</a>
      </td>
      <td class="col-md-1">
        <a onClick={e => del(item, e)}>
          <span class="glyphicon glyphicon-remove" aria-hidden="true"></span>
        </a>
      </td>
      <td class="col-md-6"></td>
    </tr>
  );
};
```

Compiles to:

```js
import { template as _$template } from "@solidjs/web";
import { delegateEvents as _$delegateEvents } from "@solidjs/web";
import { className as _$className } from "@solidjs/web";
import { effect as _$effect } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";

const _tmpl$ = /*#__PURE__*/ _$template(
  `<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`
);
const view = ({ item }) => {
  const itemId = item.id;
  return (() => {
    const _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.nextSibling,
      _el$4 = _el$3.firstChild,
      _el$5 = _el$3.nextSibling,
      _el$6 = _el$5.firstChild;
    _$insert(_el$2, itemId);
    _el$4._$$click = e => select(item, e);
    _$insert(_el$4, () => item.label);
    _el$6._$$click = e => del(item, e);
    _$effect(
      () => selected(),
      _v$ => _$className(_el$, itemId === _v$ ? "danger" : "")
    );
    return _el$;
  })();
};
_$delegateEvents(["click"]);
```

`cloneNode` (via `template()`) improves repeat insert performance and precompilation reduces references to the minimal traversal path.

## Configuration

Omitted options are the Solid 2.0 defaults that used to live in `babel-preset-solid`: `moduleName: "@solidjs/web"`, `generate: "dom"`, `wrapConditionals`, `contextToCustomElements`, and auto-import of `For` / `Show` / `Switch` / `Match` / `Loading` / `Reveal` / `Portal` / `Repeat` / `Dynamic` / `Errored`.

```js
{
  plugins: [
    [
      "@solidjs/babel-plugin",
      {
        moduleName: "@solidjs/web",
        generate: "dom",
        hydratable: true
      }
    ]
  ];
}
```

## Plugin Options

### moduleName

- Type: `string`
- Default: `"@solidjs/web"`

Runtime module the compiled output imports helpers from. Use the same module for SSR; switch `generate` instead.

### syntax

- Type: `'auto' | 'jsx' | 'tsrx'`
- Default: `'auto'`

Source syntax frontend. `"auto"` routes `.tsrx` files through the TSRX frontend and everything else through standard JSX; `"tsrx"` forces TSRX for every file; `"jsx"` disables TSRX routing entirely. See [TSRX](#tsrx-experimental).

### generate

- Type: `'dom' | 'ssr' | 'universal' | 'dynamic'`
- Default: `'dom'`

`"dom"` is client DOM output. `"ssr"` emits server strings. `"universal"` targets a custom renderer. `"dynamic"` uses the universal renderer as fallback and can route configured native tags to the DOM renderer.

### hydratable

- Type: `boolean`
- Default: `false`

Emit hydratable markers.

### dev

- Type: `boolean`
- Default: `false`

Development output. With `hydratable`, emits the hydration walk validation helpers.

### sourceNames

- Type: `boolean | { components?: boolean; bindings?: boolean }`
- Default: follows `dev` — every kind on when `dev: true`, off otherwise

Names as written in source, carried into the output so the dev and observe runtimes can label the reactive graph — in diagnostic `ownerPath`s, attribution chains, and the Performance panel tracks — even after a minifier renames everything. Unset, the option follows `dev`; `true`/`false` sets every kind (`sourceNames: false` opts a dev build out); the object form picks, and each kind it leaves unspecified follows `dev`. The production runtimes ignore the names, and production output (`dev: false`) is byte-identical whether the option is set or not. `@solidjs/compiler`'s `transform()` takes the same option with the same shape and defaults.

- `components`: emit the tag as written as a third `createComponent` argument — `<Home />` compiles to `createComponent(Home, props, "Home")`, `<Ui.Button />` to `"Ui.Button"` — so each component's owner reads `<Home>` even when a `lazy()`/HMR wrapper hides the function. Applies to DOM and SSR output; for SSR the compiler keeps the `createComponent` call it otherwise inlines to `Comp(props)`, so the server runtime labels the owner the same way (prod SSR output, without the option, is unchanged). Universal and dynamic output are unaffected.
- `bindings`: every compiled binding effect is named by what it writes, as a trailing options argument the dev and observe runtimes read and production ignores. An attribute effect gets `<tag>.<attribute>` as written — `<span textContent={label()} />` compiles to `effect(() => label(), v => …, { name: "span.textContent" })`, `class:active` to `div.class:active`, a `style={{ color: c() }}` property to `div.style:color` — and a template's merged effect lists all of its bindings (`"button.class, span.textContent"`). A hole's insert is named for the parent it fills: `<div>{count()}</div>` compiles to `insert(el, count, undefined, undefined, { name: "div.children" })`; a static child (a component call, a literal) creates no effect and gets no name. A spread passes the tag as its trailing argument (`spread(el, props, false, undefined, "div")`), and the runtime labels its attribute effect `div.spread` and its children insert `div.children`. DOM output only.

These are the JSX-level kinds — what a JSX compiler can see. Naming the primitives themselves (`createSignal(0, { name: "count" })`, `createCounter.value` inside a composed primitive) is not a JSX-transform feature and this plugin does not do it: it is `@solidjs/compiler`'s standalone `transformSourceNames` pass, which the build tool runs on every module — `.ts`, `.js`, and JSX files alike — independently of which JSX compiler handles the file. `@solidjs/vite-plugin` (its `solid: { sourceNames }` option, solid-vite-plugin #371) wires both: the JSX-level kinds through this option and primitive names through the standalone pass, for its dev and `observe` postures.

### delegateEvents

- Type: `boolean`
- Default: `true`

Automatic event delegation on camelCase.

### wrapConditionals

- Type: `boolean`
- Default: `true`

Smart conditional detection for simple boolean expressions and ternaries in JSX.

### contextToCustomElements

- Type: `boolean`
- Default: `true`

Set current render context on Custom Elements and slots, so Solid's Context API works with Web Components.

### builtIns

- Type: `string[]`
- Default: `["For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored"]`

Component exports from `moduleName` that the plugin should auto-import when it sees them in JSX.

### effectWrapper

- Type: `string | false`
- Default: `effect`

Reactive wrapper for lazy JSX expressions.

### staticMarker

- Type: `string`
- Default: `@static`

When an expression starts with this comment, the compiler treats it as static and does not wrap it in an `effect`. Not a reactivity primitive — only use it when the expression is non-reactive for the lifetime of the element and the heuristic cannot infer that.

### memoWrapper

- Type: `string | false`
- Default: `memo`

Memo function name for derived values used in many reactive computations.

### validate

- Type: `boolean`
- Default: `true`

Checks for HTML that browsers would "correct" in ways that break DOM walks. Incomplete, but covers the dangerous cases.

### omitNestedClosingTags

- Type: `boolean`
- Default: `false`

Removes unnecessary closing tags from template output. Tested against Chrome/Edge/Firefox/Safari; other HTML parsers may differ.

### omitLastClosingTag

- Type: `boolean`
- Default: `true`

Omits the last closing tag when it has no closing parent. Same parser caveat as above.

### omitQuotes

- Type: `boolean`
- Default: `true`

Drops quotes around HTML attributes when possible.

### omitAttributeSpacing

- Type: `boolean`
- Default: `true`

When `true`, quoted attributes may omit the space before the next attribute. Set `false` for strictly spaced attributes.

### requireImportSource

- Type: `string | false`
- Default: `false`

Restrict JSX transformation to files whose `@jsxImportSource` pragma matches.

```js
{
  plugins: [["@solidjs/babel-plugin", { requireImportSource: "@solidjs/web" }]];
}
```

```jsx
/** @jsxImportSource @solidjs/web */
const template = <div>Hello</div>;
```

### inlineStyles

- Type: `boolean`
- Default: `true`

Inline style attributes in templates when the value is a string or `Record<string, string>`. Disable for strong CSP configurations; styles are then set at runtime.

### serverComponents

- Type: `boolean`
- Default: `false`

SSR-only: emit behavior-claim (`_bnd`) markers for `ref` / `on*` on intrinsic elements.

### hoistProps

- Type: `boolean`
- Default: `true`

SSR-only: a component's props literal with getters compiles to a module-level constructor whose getters are shared across instances, instead of an object literal (which V8 builds in dictionary mode, allocating a closure per getter per instance):

```js
var _m$ = Symbol();
var _d$ = {
  get() {
    const props = this[_m$];
    return props.label;
  },
  enumerable: true,
  configurable: true
};
function _P$(_p, _p2) {
  this[_m$] = _p;
  this.as = _p2;
  Object.defineProperty(this, "label", _d$);
}
_P$.prototype = Object.prototype;
Comp(new _P$(props, "a"));
```

The instance has the same own keys, order and descriptors as the literal and `Object.prototype` as its prototype; `Object.keys`, spread, `hasOwn` and `isStatic()` answer as before. One contract follows: a props getter is defined only for a read through its own object (`props.x`, spread, `merge()`/`omit()`). Copying its property descriptor onto another object and reading it there throws — define a getter that reads through the source instead. Sites whose getters close over a binding that is reassigned, declared after the site, or `this`/`arguments` keep the literal. `false` keeps the literal everywhere.

## TSRX (experimental)

TSRX (TypeScript Render Extensions) is a syntax for declarative UI. `.tsrx` sources desugar to the same Solid JSX this plugin already compiles: `@if`/`@else`, `@for … @empty`, `@switch`/`@case`, and `@try`/`@catch`/`@pending` lower to the corresponding control-flow components (`Show`, `For`, `Switch`/`Match`, `Errored`, `Loading`), and `@{}` statement containers mix setup statements with rendered elements.

```tsrx
export function TodoList({ items }) @{
  <ul>
    <style>
      li { padding-block: 0.25rem; }
    </style>
    @for (const item of items; index i; key item.id) {
      <li>{i + 1}. {item.text}</li>
    } @empty {
      <li>No todos</li>
    }
  </ul>
}
```

Requirements and behavior:

- Compiling `.tsrx` sources requires the optional peer dependency `@tsrx/core` and Node.js >= 22.12. It loads lazily on first TSRX routing, so plain JSX users never pay for it.
- Routing is filename-based by default (`syntax: "auto"`), so Babel must receive a `filename`.
- Desugared constructs rely on the `builtIns` auto-imports, so those components must exist in `moduleName`.
- Scoped `<style>` blocks are removed at compile time, matching native and dynamic elements receive a `tsrx-<hash>` class, and the scoped/pruned stylesheet is returned as `result.metadata.css` with `result.metadata.cssHash`. Style expressions produce class-map objects, `<style ref={styles}>` initializes a class map, and `:global(...)` opts selectors out of scoping. The plugin emits no runtime style helper; a bundler integration must emit the CSS metadata.
- Solid rejects authored TSRX lazy destructuring (`&{ … }` / `&[ … ]`). Keep accessor calls and reactive property reads explicit in Solid source.
- Control-flow bindings pass through exactly as authored. `@for … index` / `@for … key` hand the callback the item as an accessor (and the index as an accessor under a custom key), and `@catch (err, reset)` receives Solid's `ErrorAccessor` — write `item()`, `i()`, `err()` as in JSX. Destructuring a binding in one of those positions is rejected with a diagnostic; the default keyed `@for` item is a raw value and destructures as usual.
- The native compiler ([`@solidjs/compiler`](../compiler)) compiles the same sources to byte-identical output.

## Special Binding

### ref

Assigns the DOM element to a variable, or calls a function with the element.

```jsx
const Child = props => <div ref={props.ref} />;

const Parent = () => {
  let ref;
  return <Child ref={ref} />;
};
```

### on(eventName)

CamelCase attributes such as `onClick` are event handlers. The compiler delegates events that bubble or compose, otherwise it uses Level 1 `on_____` properties.

Pass an array to bind a value: the second item is the first argument to the handler, the event is second.

```jsx
function handler(itemId, e) {
  /*...*/
}

<ul>
  {list().map(item => (
    <li onClick={[handler, item.id]} />
  ))}
</ul>;
```

Delegation works with Web Components and Shadow DOM when events are composed (custom events and most UA UI events). Custom delegated events should follow native all-lowercase naming. Use a ref that calls `addEventListener` when you need listener options or custom casing.

Event delegates are owned by render roots and are removed when those roots dispose.

### ... (spreads)

```jsx
<div {...props} />
```

Given independent binding updates, spread order is not currently guaranteed.

## Components

Capitalized tags are components. Dynamic props become getters rather than wrapped computations. Property access is tracking, so do not destructure outside computations unless the value should be static.

```jsx
const MyComp = props => {
  const staticProp = props.other;
  return (
    <>
      <div>{props.param}</div>
      <div>{staticProp}</div>
    </>
  );
};

<MyComp param={dynamic()} other={static} />;
```

`props.children` may be a node, a function, a string, or an array of those. Non-expression children evaluate lazily on access.

## Fragments

`<></>` compiles to arrays.

## Acknowledgements

The concept of compiling JSX to DOM operations (rather than HTML strings) was inspired by [Surplus](https://github.com/adamhaile/surplus).
