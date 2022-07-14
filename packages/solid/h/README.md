# Solid HyperScript

This sub module provides a HyperScript method for Solid. This is useful to use Solid in non-compiled environments or in some environments where you can only use a standard JSX transform. This method can be used as the JSX factory function.

HyperScript function takes a few forms. The 2nd props argument is optional. Children may be passed as either an array to the 2nd/3rd argument or as every argument past the 2nd.

```js
// create an element with a title attribute
h("button", { title: "My button" }, "Click Me")

// create a component with a title prop
h(Button, { title: "My button" }, "Click Me")

// create an element with many children
h("div", { title: "My button" }, h("span", "1"), h("span", "2"), h("span", "3"))
```

This is the least efficient way to use Solid as it requires a slightly larger runtime that isn't treeshakebable, and cannot leverage anything in the way of analysis, so it requires manual wrapping of expressions and has a few other caveats (see below).

## Example

```js
import { render } from "solid-js/web";
import h from "solid-js/h";
import { createSignal } from "solid-js";

function Button(props) {
  return h("button.btn-primary", props)
}

function Counter() {
  const [count, setCount] = createSignal(0);
  const increment = (e) => setCount(c => c + 1);

  return h(Button, { type: "button", onClick: increment }, count);
}

render(Counter, document.getElementById("app"));
```

## Differences from JSX

There are a few differences from Solid's JSX that are important to note. And also apply when attempting use any transformation that would compile to HyperScript.

1. Reactive expression must be manually wrapped in functions to be reactive.

```js
// jsx
<div id={props.id}>{firstName() + lastName()}</div>

// hyperscript
h("div", { id: () => props.id }, () => firstName() + lastName())
```

2. Merging spreads requires using the merge props helper to keep reactivity

```js
// jsx
<div class={selectedClass()} {...props} />

// hyperscript
import { mergeProps } from "solid-js"

h("div", mergeProps({ class: selectedClass }, props))
```

3. Events on components require explicit event in the arguments

Solid's HyperScript automatically wraps functions passed to props of components with no arguments in getters so you need to provide one to prevent this. The same applies to render props like in the `<For>` component.

```js
// good
h(Button, { onClick: (e) => console.log("Hi")});

// bad
h(Button, { onClick: () => console.log("Hi")})
```

4. All refs are callback form

We can't do the compiled assigment trick so only the callback form is supported.

```js
let myEl;

h(div, { ref: (el) => myEl = el });
```

5. There is a shorthand for static id and classes

```js
h("div#some-id.my-class")
```

6. Fragments are just arrays

```js
[h("span", "1"), h("span", "2")]
```