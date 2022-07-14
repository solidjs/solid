# Solid Tagged Template Literals

This sub module provides a Tagged Template Literal `html` method for Solid. This is useful to use Solid in non-compiled environments. This method can be used as replacement for JSX.

`html` uses `${}` to escape into JavaScript expressions. Components are closed with `<//>`

```js
// create an element with a title attribute
html`<button title="My button">Click Me</button>`

// create a component with a title prop
html`<${Button} title="My button">Click me<//>`

// create an element with dynamic attribute and spread
html`<div title=${() => selectedClass()} ...${props} />`
```

Using `html` is slightly less efficient than JSX(but more than HyperScript), requires a larger runtime that isn't treeshakebable, and cannot leverage expression analysis, so it requires manual wrapping of expressions and has a few other caveats (see below).

## Example

```js
import { render } from "solid-js/web";
import html from "solid-js/html";
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

We can't do the compiled assigment trick so only the callback form is supported.

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