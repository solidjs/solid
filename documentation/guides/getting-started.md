# Getting Started

## Try Solid

By far the easiest way to get started with Solid is trying it online. Our REPL at https://playground.solidjs.com is the perfect way to try out ideas. As is https://codesandbox.io/ where you can modify any of our [examples](../resources/examples.md).

Alternatively you can use our CLI to bootstrap client-side a project (based on [Create React App](https://github.com/facebook/create-react-app)).

> _`npm init solid <project-type> <project-name>` is available with npm 6+._

You can get started with a simple app with the CLI with by running:

```sh
> npm init solid app my-app
```

Or for a TypeScript starter:

```sh
> npm init solid app-ts my-app
```

## Learn Solid

Solid is all about small composable pieces that serve as building blocks for our applications. These pieces are mostly functions which make up many shallow top-level APIs. You don't need to know about most of them to get started.

The two main types of building blocks you have at your disposal are Components and Reactive Primitives.

Components are functions that accept a props object and return JSX elements including native DOM elements and other components. They can be expressed as JSX Elements in PascalCase:

```jsx
function MyComponent(props) {
  return <div>Hello {props.name}</div>
}

<MyComponent name="Solid" />
```

Components are lightweight as they are not stateful themselves and have no instances. Instead, they simply serve as factory functions for our DOM elements and reactive primitives.

Solid's fine-grained reactivity is built on 3 simple primitives: Signals, Memos, and Effects. Together, they form an auto-tracking synchronization engine that ensures your view stays up to date. Reactive computations take the form of simple function-wrapped expressions that execute synchronously.

```js
const [first, setFirst] = createSignal("JSON");
const [last, setLast] = createSignal("Bourne");

createEffect(() => console.log(`${first()} ${last()}`))
```

You can learn more about [Solid's Reactivity](reactivity.md) and [Solid's Rendering](rendering.md).

You can also view our full [API Reference](../api.md).

## Think Solid

Solid's design carries several opinions on what principles and values help us best build websites and applications. It is easier to learn and use Solid when you are aware of the philosophy behind it.

### 1. Declarative Data

Declarative data is the practice of tying the description of data’s behavior to its declaration. This allows for easy composition by packaging all aspects of data’s behavior in a single place.

### 2. Vanishing Components

It's hard enough to structure your components without taking updates into consideration. Solid updates are completely independent of the components. Component functions are called once and then cease to exist. Components exists to organize your code and not much else.

### 3. Read/Write segregation

Precise control and predictability make for better systems. We don't need true immutability to enforce unidirectional flow, just the ability to make the conscious decision which consumers may write and which may not.

### 4. Simple is better than easy

A lesson that comes hard for fine-grained reactivity. Explicit and consistent conventions even if they require more effort are worth it. The aim is to provide minimal tools to serve as the basis to built upon.

## Web Components

Solid was born with the desire to have Web Components as first class citizens. Over time its design has evolved and goals have changed. However, Solid is still a great way to author Web Components. [Solid Element](https://github.com/solidjs/solid/tree/main/packages/solid-element) lets you to write and wrap Solid's function components to produce small and performant Web Components. Inside Solid apps Solid Element is able to still leverage Solid's Context API and Solid's Portals support Shadow DOM isolated styling.

## Server Rendering

Solid has a dynamic server side rendering solution that enables a truly isomorphic development experience. Through the use of our Resource primitive async data requests are easily made, and more importantly automatically serialized and synchronized between client and browser.

Since Solid supports asynchronous and streaming rendering on the server, you get to write your code one way and have it execute on the server. This means that features like [render-as-you-fetch](https://reactjs.org/docs/concurrent-mode-suspense.html#approach-3-render-as-you-fetch-using-suspense) and code splitting just work in Solid.

For more information, read the [SSR guide](./server.md).

## No Compilation?

Dislike JSX? Don't mind doing manual work to wrap expressions, worse performance, and having larger bundle sizes? Alternatively, you can create a Solid app using Tagged Template Literals or HyperScript in non-compiled environments.

You can run them straight from the browser using [Skypack](https://www.skypack.dev/):

```html
<html>
  <body>
    <script type="module">
      import { createSignal, onCleanup } from "https://cdn.skypack.dev/solid-js";
      import { render } from "https://cdn.skypack.dev/solid-js/web";
      import html from "https://cdn.skypack.dev/solid-js/html";

      const App = () => {
        const [count, setCount] = createSignal(0),
          timer = setInterval(() => setCount(count() + 1), 1000);
        onCleanup(() => clearInterval(timer));
        return html`<div>${count}</div>`;
      };
      render(App, document.body);
    </script>
  </body>
</html>
```

Remember you still need the corresponding DOM Expressions library for these to work with TypeScript. You can use Tagged Template Literals with [Lit DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/main/packages/lit-dom-expressions) or HyperScript with [Hyper DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/main/packages/hyper-dom-expressions).
