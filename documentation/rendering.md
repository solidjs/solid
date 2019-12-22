# JSX Rendering

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:

- Template DOM elements which are cloned on each instantiation
- A series of reference declarations using only firstChild and nextSibling
- Fine grained computations to update the created elements.

This approach both is more performant and produces less code then creating each element one by one with document.createElement.

More documentation is available at: [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)

### Note on attribute binding order

Static attributes are created as part of the html template together. Expressions fixed and dynamic are applied afterwards in JSX binding order. While this is fine for most DOM elements there are some like input elements with `type='range'` where order matters. Keep this in mind when binding elements.

## Entry

The easiest way to mount Solid is to import render from 'solid-js/dom'. `render` takes a function as the first argument and the mounting container for the second and returns a disposal method. This `render` automatically creates the reactive root and handles rendering into the mount container. Solid assumes full control of the mount container so use an element with no children.

```jsx
import { render } from "solid-js/dom";

render(() => <App />, document.getElementById("main"));
```

## Events

on**\_** properties get added (addEventListener) as event handlers on the element. Camel Case events will be delegated by default and the second argument will be the model property or (nearest parent's). Use all lowercase for directly bound native events.

If you need to use non-lowercase or hyphenated event names use the events binding.

## Control Flow

While you could use a map function for loops they aren't optimized. While perhaps not as big of a deal in the VDOM since Solid is designed to not execute all the code from top down repeatedly we rely on techniques like isolated contexts and memoization. This is complicated and requires special methods. Currently 'For', 'Show', 'Switch/Match', 'Suspense', 'SuspenseList', and 'Portal' are supported.

```jsx
<ul>
  <For each={state.users} fallback={<div>No Users</div>}>
    {user => (
      <li>
        <div>{user.firstName}</div>
        <Show when={user.stars > 100}>
          <div>Verified</div>
        </Show>
      </li>
    )}
  </For>
</ul>
```

_Note these are designed to handle more complex scenarios like Component insertions. Child expressions are inert unless you return a function. For simple dynamic expressions use boolean or ternary operator._

## Refs

Refs come in 2 flavours. `ref` which directly assigns the value, and `forwardRef` which calls a callback `(ref) => void` with the reference. To support forwarded properties on spreads, both `ref` and `forwardRef` are called as functions.

## Server Side Rendering (Experimental)

### To use SSR on the server:

1. Configure babel-preset-solid with generate option 'ssr'

```json
"presets": [["solid", { "generate": "ssr" }]]
```

2. Use `renderSSR` entry:

```jsx
import { renderSSR } from "solid-js/dom";

renderSSR(() => <App />, document.getElementById("main"));
```

### To rehydrate on the client:

1. Configure babel-preset-solid with generate option 'hydrate'

```json
"presets": [["solid", { "generate": "hydrate" }]]
```

2. Use `hydrate` entry:

```jsx
import { hydrate } from "solid-js/dom";

hydrate(() => <App />, document.getElementById("main"));
```
