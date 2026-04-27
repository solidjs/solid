# Solid Tagged Template Literals

This sub module provides a Tagged Template Literal `html` method for Solid. This is useful to use Solid in non-compiled environments. This method can be used as replacement for JSX.

`html` uses `${}` to escape into JavaScript expressions. Components are closed with `<//>`.

Since Solid 2.0, `html` is backed by [`sld-dom-expressions`](https://www.npmjs.com/package/sld-dom-expressions), an AST-based tagged-template runtime. Templates are parsed at runtime (no `new Function` / `eval`, so it is CSP-safe) and reactive bindings are installed against the resulting DOM.

```js
// create an element with a title attribute
html`<button title="My button">Click Me</button>`

// create a component with a title prop (inline expression hole)
html`<${Button} title="My button">Click me<//>`

// create an element with dynamic attribute and spread
html`<div title=${() => selectedClass()} ...${props} />`
```

Using `html` is slightly less efficient than JSX, requires a larger runtime that isn't treeshakeable, and cannot leverage expression analysis, so it requires manual wrapping of expressions and has a few other caveats (see below).

## Example

```js
import { render } from "@solidjs/web";
import html from "@solidjs/html";
import { createSignal } from "solid-js";

function Button(props) {
  return html`<button class="btn-primary" ...${props} />`;
}

function Counter() {
  const [count, setCount] = createSignal(0);
  const increment = (e) => setCount((c) => c + 1);

  return html`<${Button} type="button" onClick=${increment}>${count}<//>`;
}

render(Counter, document.getElementById("app"));
```

## Component registry

Inline expression holes (`<${Component} />`) work without any setup, but the `sld` runtime also supports a named component registry. `html.define({ ... })` returns a new tag with the supplied components merged into the registry; capitalized tag names in the template are then looked up by name. The original `html` tag is unchanged.

```js
import html from "@solidjs/html";
import { For, Show } from "solid-js";

const tpl = html.define({ For, Show });

function List(props) {
  return tpl`
    <Show when=${() => props.items.length > 0} fallback=${tpl`<p>No items</p>`}>
      <ul>
        <For each=${() => props.items}>
          ${item => tpl`<li>${item.name}</li>`}
        </For>
      </ul>
    </Show>
  `;
}
```

An unregistered capitalized tag name throws at template-construction time, which gives tooling (codemods, syntax highlighters) something concrete to key off.

## Return shape

A `html\`...\`` expression returns a single node when the template resolves to one root, and an array of nodes when it resolves to many. Consumers that need to spread or iterate the result should normalize:

```js
const result = html`<span/><span/>`;
const nodes = Array.isArray(result) ? result : [result];
```

## Differences from JSX

There are a few differences from Solid's JSX that are important to note.

1. Reactive expression must be manually wrapped in functions to be reactive.

```js
// jsx
<div id={props.id}>{firstName() + lastName()}</div>

// hyperscript
html`<div id=${() => props.id}>${() => firstName() + lastName()}</div>`
```

2. Events on components require explicit event in the arguments

Solid's Tagged Template Literals automatically wraps functions passed to props of components with no arguments in getters so you need to provide one to prevent this. The same applies to render props like in the `<For>` component.

```js
// good
html`<${Button} onClick=${(e) => console.log("Hi")} />`;

// bad
html`<${Button} onClick=${() => console.log("Hi")} />`;
```

4. All refs are callback form

We can't do the compiled assignment trick so only the callback form is supported.

```js
let myEl;
html`<div ref=${(el) => myEl = el} />`;
```

5. There can be multiple top level elements

No need for fragments just:
```js
html`
  <div>1</div>
  <div>2</div>
`
```