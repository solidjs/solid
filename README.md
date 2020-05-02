## <img src="https://raw.githubusercontent.com/ryansolid/solid/master/assets/logo.png" alt="Solid" width="500"/><br>
[![Build Status](https://img.shields.io/travis/com/ryansolid/solid.svg?style=flat)](https://travis-ci.com/ryansolid/solid)
[![Coverage Status](https://img.shields.io/coveralls/github/ryansolid/solid.svg?style=flat)](https://coveralls.io/github/ryansolid/solid?branch=master)
[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=flat)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dt/solid-js.svg?style=flat)](https://www.npmjs.com/package/solid-js)
[![Gitter](https://img.shields.io/gitter/room/solidjs-community/community)](https://gitter.im/solidjs-community/community)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=social)](https://www.reddit.com/r/solidjs/)

Solid is a declarative Javascript library for creating user interfaces. It does not use a Virtual DOM. Instead it opts to compile its templates down to real DOM nodes and wrap updates in fine grained reactions. This way when your state updates only the code that depends on it runs.

### Key Features

- Real DOM with fine-grained updates (<b>No Virtual DOM! No Dirty Checking Digest Loop!</b>).
- Declarative data
  - Simple composable primitives without the hidden rules.
  - Function Components with no need for lifecycle methods or specialized configuration objects.
  - Render once mental model.
- Fast! Almost indistinguishable performance vs optimized painfully imperative vanilla DOM code. See Solid on [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark).
- Small! Completely tree-shakeable Solid's compiler will only include parts of the library you use.
- Supports modern features like JSX, Fragments, Context, Portals, Suspense, SSR, Error Boundaries and Asynchronous Rendering.
- Built on TypeScript.
- Webcomponent friendly
  - Context API that spans Custom Elements
  - Implicit event delegation with Shadow DOM Retargeting
  - Shadow DOM Portals
- Transparent debugging: a `<div>` is just a div.

## The Gist
```jsx
import { render } from "solid-js/dom";

const HelloMessage = props => <div>Hello {props.name}</div>;

render(
  () => <HelloMessage name="Taylor" />,
  document.getElementById("hello-example")
);
```

A Simple Component is just a function that accepts properties. Solid uses a `render` function to create the reactive mount point of your application.

The JSX is then compiled down to efficient real DOM expressions:

```js
import { render, template, insert, createComponent } from "solid-js/dom";

const _tmpl$ = template(`<div>Hello </div>`);

const HelloMessage = props => {
  const _el$ = _tmpl$.cloneNode(true);
  insert(_el$, () => props.name, null);
  return _el$;
};

render(
  () => createComponent(HelloMessage, { name: "Taylor" }),
  document.getElementById("hello-example")
);
```

That `_el$` is a real div element and `props.name`, `Taylor` in this case, is appended to it's child nodes. Notice that `props.name` is wrapped in a function. That is because that is the only part of this component that will ever execute again. Even if a name is updated from the outside only that one expression will be re-evaluated. The compiler optimizes initial render and the runtime optimizes updates. It's the best of both worlds.

## Installation

You can get started with a simple app with the CLI with by running:

```sh
> npm init solid app my-app
```

Use `app-ts` for a TypeScript starter.

_`npm init solid <project-type> <project-name>` is available with npm 6+._

Or you can install the dependencies in your own project. To use Solid with JSX (recommended) run:

```sh
> npm install solid-js babel-preset-solid
```

## Solid Rendering

Solid's rendering is done by the [DOM Expressions](https://github.com/ryansolid/dom-expressions) library. This library provides a generic optimized runtime for fine grained libraries like Solid with the opportunity to use a number of different Rendering APIs. The best option is to use JSX pre-compilation with [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/babel-plugin-jsx-dom-expressions) to give the smallest code size, cleanest syntax, and most performant code. The compiler converts JSX to native DOM element instructions and wraps dynamic expressions in reactive computations.

The easiest way to get setup is add `babel-preset-solid` to your .babelrc, or babel config for webpack, or rollup:

```js
"presets": ["solid"]
```

Remember even though the syntax is almost identical, there are significant differences between how Solid's JSX works and a library like React. Refer to [JSX Rendering](../master/documentation/rendering.md) for more information.

Alternatively in non-compiled environments you can use Tagged Template Literals [Lit DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/lit-dom-expressions) or even HyperScript with [Hyper DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/hyper-dom-expressions).

For convenience Solid exports interfaces to runtimes for these as:

```js
import h from "solid-js/h";
import html from "solid-js/html";
```

Remember you still need to install the library separately for these to work.

## Solid State

Solid's data management is built off a set of flexible reactive primitives. Similar to React Hooks except instead of whitelisting change for an owning Component they independentally are soley responsible for all the updates.

Solid's State primitive is arguably its most powerful and distinctive one. Through the use of proxies and explicit setters it gives the control of an immutable interface and the performance of a mutable one. The setters support a variety of forms, but to get started set and update state with an object.

```jsx
import { createState, onCleanup } from "solid-js";

const CountingComponent = () => {
  const [state, setState] = createState({ counter: 0 });

  const interval = setInterval(
    () => setState({ counter: state.counter + 1 }),
    1000
  );

  onCleanup(() => clearInterval(interval));

  return <div>{state.counter}</div>;
};
```

Where the magic happens is with computations(effects and memos) which automatically track dependencies.

```js
const [state, setState] = createState({ user: { firstName: "Jake", lastName: "Smith" }})

createEffect(() =>
  setState({
    displayName: `${state.user.firstName} ${state.user.lastName}`
  })
);

console.log(state.displayName); // Jake Smith
setState('user', {firstName: "Jacob" });
console.log(state.displayName); // Jacob Smith
```

Whenever any dependency changes the State value will update immediately. Each `setState` statement will notify subscribers synchronously with all changes applied. This means you can depend on the value being set on the next line.

Solid State also exposes a reconcile method used with `setState` that does deep diffing to allow for automatic efficient interopt with immutable store technologies like Redux, Apollo(GraphQL), or RxJS.

```js
const unsubscribe = store.subscribe(({ todos }) => (
  setState('todos', reconcile(todos)));
);
onCleanup(() => unsubscribe());
```

Read these two introductory articles by [@aftzl](https://github.com/atfzl):

[Understanding Solid: Reactivity Basics](https://dev.to/atfzl/understanding-solid-reactivity-basics-39kk)

[Understanding Solid: JSX](https://dev.to/atfzl/understanding-solid-jsx-584p)

And check out the Documentation, Examples, and Articles below to get more familiar with Solid.

## Documentation

- [State](https://github.com/ryansolid/solid/blob/master/documentation/state.md)
- [Reactivity](https://github.com/ryansolid/solid/blob/master/documentation/reactivity.md)
- [JSX Rendering](https://github.com/ryansolid/solid/blob/master/documentation/rendering.md)
- [Components](https://github.com/ryansolid/solid/blob/master/documentation/components.md)
- [Styling](https://github.com/ryansolid/solid/blob/master/documentation/styling.md)
- [Context](https://github.com/ryansolid/solid/blob/master/documentation/context.md)
- [Suspense](https://github.com/ryansolid/solid/blob/master/documentation/suspense.md)
- [API](https://github.com/ryansolid/solid/blob/master/documentation/api.md)
- [Comparison with other Libraries](https://github.com/ryansolid/solid/blob/master/documentation/comparison.md)
- [Storybook](https://github.com/ryansolid/solid/blob/master/documentation/storybook.md)

## Examples

- [Counter](https://codesandbox.io/s/8no2n9k94l) Simple Counter
- [SCSS Counter](https://codesandbox.io/s/scss-solid-counter-nr6we) Simple Counter with SCSS styling
- [Simple Todos](https://codesandbox.io/s/lrm786ojqz) Todos with LocalStorage persistence
- [Simple Routing](https://codesandbox.io/s/jjp8m8nlz5) Use 'switch' control flow for simple routing
- [Scoreboard](https://codesandbox.io/s/solid-scoreboard-sjpje) Make use of hooks to do some simple transitions
- [Form Validation](https://codesandbox.io/s/solid-form-validation-2cdti) HTML 5 validators with custom async validation
- [Styled Components](https://codesandbox.io/s/solid-styled-components-yv2t1) A simple example of creating Styled Components.
- [Styled JSX](https://codesandbox.io/s/solid-styled-jsx-xgx6b) A simple example of using Styled JSX with Solid.
- [Counter Context](https://codesandbox.io/s/counter-context-gur76) Implement a global store with Context API
- [Async Resource](https://codesandbox.io/s/2o4wmxj9zy) Ajax requests to SWAPI with Promise cancellation
- [Suspense](https://codesandbox.io/s/5v67oym224) Various Async loading with Solid's Suspend control flow
- [Suspense Tabs](https://codesandbox.io/s/solid-suspense-tabs-vkgpj) Defered loading spinners for smooth UX.
- [SuspenseList](https://codesandbox.io/s/solid-suspenselist-eorvk) Orchestrating multiple Suspense Components.
- [Redux Undoable Todos](https://codesandbox.io/s/pkjw38r8mj) Example from Redux site done with Solid.
- [Simple Todos Template Literals](https://codesandbox.io/s/jpm68z1q33) Simple Todos using Lit DOM Expressions
- [Simple Todos HyperScript](https://codesandbox.io/s/0vmjlmq94v) Simple Todos using Hyper DOM Expressions
- [TodoMVC](https://github.com/ryansolid/solid-todomvc) Classic TodoMVC example
- [Real World Demo](https://github.com/ryansolid/solid-realworld) Real World Demo for Solid
- [Hacker News App](https://github.com/ryansolid/solid-hackernews-app) Small application to showcase Solid Element
- [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/solid) The one and only
- [Sierpinski's Triangle Demo](https://github.com/ryansolid/solid-sierpinski-triangle-demo) Solid implementation of the React Fiber demo.
- [WebComponent Todos](https://github.com/shprink/web-components-todo/tree/master/solid) Showing off Solid Element
- [UIBench Benchmark](https://github.com/ryansolid/solid-uibench) a benchmark tests a variety of UI scenarios.
- [DBMon Benchmark](https://github.com/ryansolid/solid-dbmon) A benchmark testing ability of libraries to render unoptimized data.

## Related Projects

- [Solid Element](https://github.com/ryansolid/solid/blob/master/packages/solid-element)
  Extensions to Solid.js that add a Web Component wrapper.
- [Solid Styled Components](https://github.com/ryansolid/solid/blob/master/packages/solid-styled-components)
  Styled Components for Solid using 1kb library Goober.
- [Solid Styled JSX](https://github.com/ryansolid/solid/blob/master/packages/solid-styled-jsx)
  Wrapper for using Solid with Zeit's Styled JSX.
- [Solid RX](https://github.com/ryansolid/solid/blob/master/packages/solid-rx)
  Functional Reactive Programming extensions for SolidJS.
- [DOM Expressions](https://github.com/ryansolid/dom-expressions)
  The renderer behind Solid.js that enables lightning fast fine grained performance.
- [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/babel-plugin-jsx-dom-expressions)
  Babel plugin that converts JSX to DOM Expressions.
- [Lit DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/lit-dom-expressions)
  Tagged Template Literal API for DOM Expressions.
- [Hyper DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/hyper-dom-expressions)
  HyperScript API for DOM Expressions.
- [Solid Hot Loader](https://github.com/ryansolid/solid-hot-loader)
  Webpack Loader for HMR for Solid Components.
- [React Solid State](https://github.com/ryansolid/solid/blob/master/packages/react-solid-state)
  React Hooks API to use Solid.js paradigm in your existing React apps.

## Latest Articles

- [Thinking Granular: How is SolidJS so Performant?](https://dev.to/ryansolid/thinking-granular-how-is-solidjs-so-performant-4g37) An end to end look at what makes SolidJS so fast.
- [A Solid RealWorld Demo Comparison of JavaScript Frameworks](https://levelup.gitconnected.com/a-solid-realworld-demo-comparison-8c3363448fd8) How does Solid perform in a larger application?
- [Designing SolidJS: Abstraction](https://levelup.gitconnected.com/designing-solidjs-abstraction-66d8c63fa7d1?source=friends_link&sk=9cc520bbba3d97872a78081a8ab7b259) Understanding both the power and cost of abstraction.
- [Designing SolidJS: Suspense](https://itnext.io/designing-solidjs-suspense-f4e92c625cb5?source=friends_link&sk=f06f93d28632daba59048ed3d6d6b0a5) React isn't the only library that stops time.
- [Designing SolidJS: JSX](https://medium.com/@ryansolid/designing-solidjs-jsx-50ee2b791d4c?source=friends_link&sk=ef3d7ada15b50a6b5b7f5aee2cb8f952) How is it that the syntax born of the Virtual DOM is also secretly the best syntax for Reactive UI libraries?
- [Designing SolidJS: Immutability](https://medium.com/javascript-in-plain-english/designing-solidjs-immutability-f1e46fe9f321?source=friends_link&sk=912e32c63353ff0e084630bf3b63a8b1) Can Reactive State Management be both Immutable and also the most performant?
- [Designing SolidJS: Components](https://medium.com/@ryansolid/designing-solidjs-components-8f1ebb88d78b?source=friends_link&sk=cac89d1679d8be2c7bf2b303fabd153c) Exploring Solid's "Vanishing" Components
- [Designing SolidJS: Reactivity](https://medium.com/@ryansolid/designing-solidjs-reactivity-75180a4c74b4?source=friends_link&sk=dbb9dd46a2e902c199ad3d5c7aeb1566) Finding the right reactivity model for Solid.
- [Designing SolidJS: Dualities](https://medium.com/@ryansolid/designing-solidjs-dualities-69ee4c08aa03?source=friends_link&sk=161ddd70db4fca50d6f33b6d53056d36) How exploring opposites can help us redefine the whole problem space.
- [How we wrote the Fastest JavaScript UI Frameworks](https://medium.com/@ryansolid/how-we-wrote-the-fastest-javascript-ui-frameworks-a96f2636431e) How Solid topped the JS Framework Benchmark.
- [Finding Fine Grained Reactive Programming](https://levelup.gitconnected.com/finding-fine-grained-reactive-programming-89741994ddee?source=friends_link&sk=31c66a70c1dce7dd5f3f4229423ad127) Introduction to the inner workings of Solid's Reactive system.
- [The Real Cost of UI Components](https://medium.com/better-programming/the-real-cost-of-ui-components-6d2da4aba205?source=friends_link&sk=a412aa18825c8424870d72a556db2169) Comparison of the cost of Components in different UI Libraries.
- [The Fastest Way to Render the DOM](https://medium.com/@ryansolid/the-fastest-way-to-render-the-dom-e3b226b15ca3?source=friends_link&sk=5ae1688dde789e46cecf5c976e708da5) Comparison of all Solid Renderers against the Fastest Libraries in the World.
- [JavaScript UI Compilers: Comparing Svelte and Solid](https://medium.com/@ryansolid/javascript-ui-compilers-comparing-svelte-and-solid-cbcba2120cea) A closer look at precompiled UI libraries
- [Building a Simple JavaScript App with Solid](https://levelup.gitconnected.com/building-a-simple-javascript-app-with-solid-ff17c8836409) Dissecting building TodoMVC with Solid.
- [Solid — The Best JavaScript UI Library You’ve Never Heard Of](https://levelup.gitconnected.com/solid-the-best-javascript-ui-library-youve-never-heard-of-297b22848ac1?source=friends_link&sk=d61fc9352b4a98c6c9f5f6bd2077a722)
- [What Every JavaScript Framework Could Learn from React](https://medium.com/@ryansolid/what-every-javascript-framework-could-learn-from-react-1e2bbd9feb09?source=friends_link&sk=75b3f6f90eecc7d210814baa2d5ab52c) The lessons Solid learned from React.
- [React Hooks: Has React Jumped the Shark?](https://medium.com/js-dojo/react-hooks-has-react-jumped-the-shark-c8cf04e246cf?source=friends_link&sk=a5017cca813ea970b480cc44afb32034) Comparison of React Hooks to Solid.
- [How I wrote the Fastest JavaScript UI Framework](https://medium.com/@ryansolid/how-i-wrote-the-fastest-javascript-ui-framework-37525b42d6c9?source=friends_link&sk=8eb9387a535a306d1eb96f7ce88c4db5) The key to Solid's performance.
- [Part 5: JS Frameworks in 2019](https://medium.com/@ryansolid/b-y-o-f-part-5-js-frameworks-in-2019-deb9c4d3e74)
- [Part 4: Rendering the DOM](https://medium.com/@ryansolid/b-y-o-f-part-4-rendering-the-dom-753657689647)
- [Part 3: Change Management in JavaScript Frameworks](https://medium.com/@ryansolid/b-y-o-f-part-3-change-management-in-javascript-frameworks-6af6e436f63c)
- [Part 2: Web Components as Containers](https://medium.com/@ryansolid/b-y-o-f-part-2-web-components-as-containers-85e04a7d96e9)
- [Part 1: Writing a JS Framework in 2018](https://medium.com/@ryansolid/b-y-o-f-part-1-writing-a-js-framework-in-2018-b02a41026929)

## Status

Solid is mostly feature complete for its v1.0.0 release. The next releases will be mostly bug fixes API tweaks on the road to stability.
