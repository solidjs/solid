## <img src="assets/logo.png" alt="drawing" width="500"/><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;The Deceptively Simple User Interface Library

[![Build Status](https://img.shields.io/travis/com/ryansolid/solid.svg?style=flat)](https://travis-ci.com/ryansolid/solid)
[![Coverage Status](https://img.shields.io/coveralls/github/ryansolid/solid.svg?style=flat)](https://coveralls.io/github/ryansolid/solid?branch=master)
[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=flat)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=flat)](https://www.npmjs.com/package/solid-js)
[![Gitter](https://img.shields.io/gitter/room/solidjs-community/community)](https://gitter.im/solidjs-community/community)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=social)](https://www.reddit.com/r/solidjs/)


Solid is yet another declarative Javascript library for creating user interfaces.  It does not use a Virtual DOM. Instead it opts to compile its templates down to real DOM nodes and wrap updates in fine grained computations. This way when your state updates only the code that depends on it runs.

### Key Features
* Real DOM with fine-grained updates (<b>No Virtual DOM! No Dirty Checking Digest Loop!</b>).
* Declarative data
  * Simple composable primitives without the hidden rules.
  * Function Components with no need for lifecycle methods or specialized configuration objects.
* Almost indistinguishable performance vs optimized painfully imperative vanilla DOM code. See Solid on [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark).
* Supports modern features like JSX Fragments, Context, Portals, Suspense, and Asynchronous Rendering.
* Webcomponent friendly
  * Implicit event delegation with Shadow DOM Retargeting
  * Shadow DOM Portals
  * Custom Element friendly Suspense flow

<br />
A Simple Component looks like:

```jsx
const HelloMessage = ({name}) => (
  <div>
    Hello {name}
  </div>
);

render(
  () => <HelloMessage name="Taylor" />,
  document.getElementById("hello-example")
);
```

## Installation

To use Solid with JSX (recommended) run:
```sh
> npm install solid-js babel-preset-solid
```

Or you can get started with a simple app with the CLI with by running:
```sh
> npm init solid app my-app
```
_`npm init solid <project-type> <project-name>` is available with npm 6+._

## Solid State

It all starts with State. State objects are immutable so to update you call their companion setter function. Through the use of proxies they give the control of an immutable interface and the performance of a mutable one. Note only Plain Objects and Arrays are deeply wrapped.

```jsx
import { createState, onCleanup } from 'solid-js'

const CountingComponent = () => {
  const [state, setState] = createState({counter: 0});

  const interval = setInterval(() =>
    setState({counter: state.counter + 1})
  , 1000);

  onCleanup(() => clearInterval(interval));

  return <div>{(state.counter)}</div>;
}
```

You can also deep set:

```js
const [state, setState] = createState({
  user: {
    firstName: 'John'
    lastName: 'Smith'
  }
});

setState('user', {firstName: 'Jake', middleName: 'Reese'});
```

You can also use functions:
```js
const [state, setState] = createState({counter: 0});
setState('counter', c => c + 1);
```

This takes the form similar to ImmutableJS setIn for leaving all mutation control at the top level state object. Keep in mind that setState when setting an object attempts to merge instead of replace.

But where the magic happens is with computations(effects and memos) which automatically track dependencies.

```js
createEffect(() =>
  setState({
    displayName: `${state.user.firstName} ${state.user.lastName}`
  })
);

console.log(state.displayName); // Jake Smith
```

Whenever any dependency changes the State value will immediately update. JSX expressions can also be wrapped in effects so for something as trivial as a display name you could just inline the expression in the template and have it update automatically.

Solid State also exposes a reconcile method used with setState that does deep diffing to allow for automatic efficient interopt with immutable store technologies like Redux, Apollo, or RxJS.

```js
const unsubscribe = store.subscribe(({ todos }) => (
  setState(reconcile('todos', todos)));
);
onCleanup(() => unsubscribe());
```

## Solid Rendering

Solid's rendering is done by the [DOM Expressions](https://github.com/ryansolid/dom-expressions) library. This library provides a generic optimized runtime for fine grained libraries like Solid with the opportunity to use a number of different Rendering APIs. The best option is to use JSX pre-compilation with [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) to give the smallest code size, cleanest syntax, and most performant code. The compiler converts JSX to native DOM element instructions and wraps expressions to be wrapped in our computations when indicated by in inner parens `{( )}`.

> Prettier and some compile to JS libraries like CoffeeScript will strip Parenthesis causing issues with Solid's JSX. So unfortunately they are incompatible at this time. Use `// prettier-ignore` at the top of your JSX to have Prettier not format your JSX.

The easiest way to get setup is add `babel-preset-solid` to your .babelrc, or babel config for webpack, or rollup:

```js
"presets": ["solid"]
```

Alternatively in non-compiled environments you can use Tagged Template Literals [Lit DOM Expressions](https://github.com/ryansolid/lit-dom-expressions) or even HyperScript with [Hyper DOM Expressions](https://github.com/ryansolid/hyper-dom-expressions).

For convenience Solid exports interfaces to runtimes for these as:
```js
import h from 'solid-js/h';
import html from 'solid-js/html'
```
Remember you still need to install the library separately for these to work.

## Why?

This project started as trying to find a small performant library to work with Web Components, that had easy interopt with existing standards. It is very much inspired by fine-grain change detection libraries like Knockout.js and RxJS. The idea here is to ease users into the world of Observable programming by keeping it transparent and starting simple. Classically the Virtual DOM as seen in React for all its advances has some signifigant trade-offs:

* The VDOM render while performant is still conceptually a constant re-render
  * It feels much more imperative as variable declarations and iterative methods for constructing the tree are constantly re-evaluating.
* Reintroduced lifecycle function hell that breaks apart the declarative nature of the data. E.g., relying on blacklisting changes across the tree with shouldComponentUpdate.
* Homogenous promise of Components and the overly simplistic local state in practice:
  * Imposes boundaries on components to solve performance concerns
  * Places you into a very specific but not necessarily obvious structure
  * Only served to make it more ambiguous when emerging best practices lead to specialized component classification anyway
* Abstracts debugging to the point a ```<div />``` is not longer just a div
* VDOM libraries still are based around having specialized data objects.

So the driving questions here are:
* If the data is going to be specialized anyway can we use Proxies to move the complexity into it rather than the rendering while keeping the appearance simple?
* Can this free up existing constraints on how you modularize your view code?
* Does this approach ultimately provide more adaptibility while reducing the API surface?
* Is fine grained change detection fundamentally more performant than the Virtual DOM?

Admittedly it takes a strong reason to not go with the general consensus of best, and most supported libraries and frameworks. And React's Hooks API addresses the majority of what I once considered its most untenable faults. But I believe there is a better way out there than how we do it today.

I cover this in more detail in my Bring Your Own Framework Blog Series (links below).

## Documentation

* [State](../master/documentation/state.md)
* [Signals](../master/documentation/signals.md)
* [JSX Rendering](../master/documentation/rendering.md)
* [Components](../master/documentation/components.md)
* [Context](../master/documentation/context.md)
* [API](../master/documentation/api.md)
* [Comparison with other Libraries](../master/documentation/comparison.md)

## Examples

* [Counter](https://codesandbox.io/s/8no2n9k94l) Simple Counter
* [Simple Todos](https://codesandbox.io/s/lrm786ojqz) Todos with LocalStorage persistence
* [Simple Routing](https://codesandbox.io/s/jjp8m8nlz5) Use 'switch' control flow for simple routing
* [Scoreboard](https://codesandbox.io/s/solid-scoreboard-sjpje) Make use of hooks to do some simple transitions
* [Async Resource](https://codesandbox.io/s/2o4wmxj9zy) Ajax requests to SWAPI with Promise cancellation
* [Suspense](https://codesandbox.io/s/5v67oym224) Various Async loading with Solid's Suspend control flow
* [Redux Undoable Todos](https://codesandbox.io/s/pkjw38r8mj) Example from Redux site done with Solid.
* [Simple Todos Template Literals](https://codesandbox.io/s/jpm68z1q33) Simple Todos using Lit DOM Expressions
* [Simple Todos HyperScript](https://codesandbox.io/s/0vmjlmq94v) Simple Todos using Hyper DOM Expressions
* [TodoMVC](https://github.com/ryansolid/solid-todomvc) Classic TodoMVC example
* [Hacker News App](https://github.com/ryansolid/solid-hackernews-app) Small application to showcase Solid and Solid Element
* [WebComponent Todos](https://github.com/shprink/web-components-todo/tree/master/solid) Showing off Solid Element
* [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/solid) The one and only
* [UIBench Benchmark](https://github.com/ryansolid/solid-uibench) a benchmark tests a variety of UI scenarios.
* [DBMon Benchmark](https://github.com/ryansolid/solid-dbmon) A benchmark testing ability of libraries to render unoptimized data.
* [Sierpinski's Triangle Demo](https://github.com/ryansolid/solid-sierpinski-triangle-demo) Solid implementation of the React Fiber demo.

## Related Projects

* [Solid Element](https://github.com/ryansolid/solid-element)
Extensions to Solid.js that add a Web Component wrapper and Hot Module Replacement.
* [DOM Expressions](https://github.com/ryansolid/dom-expressions)
The renderer behind Solid.js that enables lightning fast fine grained performance.
* [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)
Babel plugin that converts JSX to DOM Expressions.
* [Lit DOM Expressions](https://github.com/ryansolid/lit-dom-expressions)
Tagged Template Literal API for DOM Expressions.
* [Hyper DOM Expressions](https://github.com/ryansolid/hyper-dom-expressions)
HyperScript API for DOM Expressions.
* [React Solid State](https://github.com/ryansolid/react-solid-state)
React Hooks API to use Solid.js paradigm in your existing React apps.

## Articles

* [Designing SolidJS: Dualities](https://medium.com/@ryansolid/designing-solidjs-dualities-69ee4c08aa03?source=friends_link&sk=161ddd70db4fca50d6f33b6d53056d36) How exploring opposites can help us redefine the whole problem space.
* [How we wrote the Fastest JavaScript UI Frameworks](https://medium.com/@ryansolid/how-we-wrote-the-fastest-javascript-ui-frameworks-a96f2636431e) How Solid topped the JS Framework Benchmark.
* [Finding Fine Grained Reactive Programming](https://levelup.gitconnected.com/finding-fine-grained-reactive-programming-89741994ddee?source=friends_link&sk=31c66a70c1dce7dd5f3f4229423ad127) Introduction to the inner workings of Solid's Reactive system.
* [The Real Cost of UI Components](https://medium.com/better-programming/the-real-cost-of-ui-components-6d2da4aba205?source=friends_link&sk=a412aa18825c8424870d72a556db2169) Comparison of the cost of Components in different UI Libraries.
* [The Fastest Way to Render the DOM](https://medium.com/@ryansolid/the-fastest-way-to-render-the-dom-e3b226b15ca3?source=friends_link&sk=5ae1688dde789e46cecf5c976e708da5) Comparison of all Solid Renderers against the Fastest Libraries in the World.
* [JavaScript UI Compilers: Comparing Svelte and Solid](https://medium.com/@ryansolid/javascript-ui-compilers-comparing-svelte-and-solid-cbcba2120cea) A closer look at precompiled UI libraries
* [Building a Simple JavaScript App with Solid](https://levelup.gitconnected.com/building-a-simple-javascript-app-with-solid-ff17c8836409) Dissecting building TodoMVC with Solid.
* [Solid — The Best JavaScript UI Library You’ve Never Heard Of](https://levelup.gitconnected.com/solid-the-best-javascript-ui-library-youve-never-heard-of-297b22848ac1?source=friends_link&sk=d61fc9352b4a98c6c9f5f6bd2077a722)
* [What Every JavaScript Framework Could Learn from React](https://medium.com/@ryansolid/what-every-javascript-framework-could-learn-from-react-1e2bbd9feb09?source=friends_link&sk=75b3f6f90eecc7d210814baa2d5ab52c) The lessons Solid learned from React.
* [React Hooks: Has React Jumped the Shark?](https://medium.com/js-dojo/react-hooks-has-react-jumped-the-shark-c8cf04e246cf?source=friends_link&sk=a5017cca813ea970b480cc44afb32034) Comparison of React Hooks to Solid.
* [How I wrote the Fastest JavaScript UI Framework](https://medium.com/@ryansolid/how-i-wrote-the-fastest-javascript-ui-framework-37525b42d6c9?source=friends_link&sk=8eb9387a535a306d1eb96f7ce88c4db5) The key to Solid's performance.
* [Part 5: JS Frameworks in 2019](https://medium.com/@ryansolid/b-y-o-f-part-5-js-frameworks-in-2019-deb9c4d3e74)
* [Part 4: Rendering the DOM](https://medium.com/@ryansolid/b-y-o-f-part-4-rendering-the-dom-753657689647)
* [Part 3: Change Management in JavaScript Frameworks](https://medium.com/@ryansolid/b-y-o-f-part-3-change-management-in-javascript-frameworks-6af6e436f63c)
* [Part 2: Web Components as Containers](https://medium.com/@ryansolid/b-y-o-f-part-2-web-components-as-containers-85e04a7d96e9)
* [Part 1: Writing a JS Framework in 2018](https://medium.com/@ryansolid/b-y-o-f-part-1-writing-a-js-framework-in-2018-b02a41026929)

## Status

This project is still a work in progress. While Solid's change management is reaching stability (this repo), I am still refining the rendering APIs from the [DOM Expressions](https://github.com/ryansolid/dom-expressions).
