# Solid.js

Solid.js is yet another declaritive Javascript library for creating user interfaces.  It does not use the Virtual DOM. Instead it opts to compile it's templates down to real DOM nodes and wrap updates in fine grained computations.

### Key Features:
* Real DOM with fine grained change detection (<b>No Virtual DOM! No Dirty Checking Digest Loop!</b>)
* JSX precompilation with support for standard JSX features and W3C Web Components
* Declarative data
  * Data behavior is part of the declaration
  * No need for lifecycle functions, and the large chains of conditionals they bring.
* ES6 Proxies to keep data access simple and POJO like
* Expandable custom operators and binding directives.
* Immutable interface with performance of mutability.
* Performance amongst the fastest libraries. See Solid on [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark)

<br />
A Simple Component could look like:

```jsx
import { root } from 'solid-js'

const MyComponent = props =>
  <>
    <h1>Welcome</h1>
    <p>Hello {(props.name)}</p>
  </>

root(() => mountEl.appendChild(<MyComponent name='Taylor' />));
```

## Installation

```sh
> npm install solid-js s-js babel-plugin-jsx-dom-expressions
```

## Solid State

It all starts with a State object. These objects can represent the local state or the props in your components. State objects look like plain javascript options except to control change detection you call their setter method. They give the control of an immutable interface and the performance of a mutable one.

```jsx
import { root, useState } from 'solid-js'

const CountingComponent = () => {
  const [state, setState] = useState({counter: 0}),
    interval = setInterval(() => setState({
      counter: state.counter + 1
    }), 1000);
  useCleanup(() => clearInterval(interval));

  return <div>{(state.counter)}</div>
}
```

You can also deep set:

```js
const [state, setState] = useState({
  user: {
    firstName: 'John'
    lastName: 'Smith'
  }
});

setState('user', {firstName: 'Jake', middleName: 'Reese'});
```

You can also use functions:
```js
const [state, setState] = useState({counter: 0});
setState('counter', c => c + 1);
```

This takes the form similar to ImmutableJS for set and setIn leaving all mutation control at the top level state object.

But where the magic happens is with computations(effects and memos) which automatically track dependencies.

```js
useEffect(() => setState({
  displayName: `${state.user.firstName} ${state.user.lastName}`
}));

console.log(state.displayName); // Jake Smith
```

Whenever any dependency changes the State value will immediately update. Internally all JSX expressions also get wrapped in effects so for something as trivial as a display name you could just inline the expression in the template and have it update automatically.

This is also primary mechanism to interopt with store technologies like Redux, Apollo, RxJS which expose themselves as Observables or Promises. When you hook up these effects you can use standard methods to map the properties you want and the reconcile method will diff the changes to only affect the minimal amount.

```js
useEffect(() => {
  const disposable = store.observable()
    .subscribe(({ todos }) => setState(reconcile('todos', todos)));
  useCleanup(() => disposable.unsubscribe());
});
```

## Solid Rendering

To accomplish rendering we use JSX for templating that gets compiled to native DOM element instructions. To do that we take advantage of the [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) which while converting JSX to DOM element instructions wraps expressions to be wrapped in our computeds.

JSX as a templating language brings a lot of benefits. The just being javascript goes beyond just not needing a DSL, but setting up closure based context instead of creating context objects. This is more transparent and easier to follow and debug.

To get setup add this babel plugin config to your .babelrc, webpack, or rollup config:

```js
"plugins": ["jsx-dom-expressions"]
```

And include at the top of your files:

```js
import { r } from 'solid-js/dom'
```

## Components

Templates in Solid are just Pascal(Capital) cased functions. Their first argument is an props object and generally return their DOM nodes to render. Other than that nothing is special about them. Unlike Virtual Dom libraries these functions can contain state as they are not called repeatedly but only executed on initial creation.

Since the all nodes from JSX are actual DOM nodes the only responsibility of top level Templates/Components is appending to the DOM. Since contexts/lifecycle management is independent of code modularization through registering event handlers Solid Templates are sufficient as is to act as Components, or Solid fits easily into other Component structures like Web Components.

```jsx
import { useState, root } from 'solid-js'

class Component extends HTMLElement {
  constructor () {
    const [state, setState] = useState({}),
      [props, __setProps] = useState({});
    Object.assign(this, {state, setState, props, __setProps});
  }

  connectedCallback() {
    this.attachShadow({mode: 'open'});
    root(() => this.shadowRoot.appendChild(this.render());
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    this.__setProps({[attr]: newVal});
  }
}

class MyComponent extends Component {
  constuctor () {
    super();
    this.setState({greeting: 'World'});
  }
  render() {
    return <div>Hello {(state.greeting)}</div>
  }
}
```

## Why?

This project started as trying to find a small performant library to work with Web Components, that had easy interopt with existing standards. It is very inspired by fine grain change detection libraries like Knockout.js and RxJS. The idea here is to ease users into the world of Observable programming by keeping it transparent and starting simple. Classically the Virtual DOM as seen in React for all it's advances has some signifigant trade offs:

* The VDOM render while performant is still conceptually a constant re-render
  * It feels much more imperative as variable declarations and iterative methods for constructing the tree are constantly re-evaluating.
* Reintroduced lifecycle function hell that break apart the declarative nature of the data. Ex. relying on blacklisting changes across the tree with shouldComponentUpdate.
* Homogenous promise of Components and the overly simplistic local state in practice:
  * Imposes boundaries on components to solve performance concerns
  * Prices you into a very specific but not necessarily obvious structure
  * Only served to make it more ambiguous when emerging best practices lead to specialized component classification anyway
* Abstracts debugging to the point a ```<div />``` is not longer just a div
* VDOM libraries still are based around having a specialized data objects.

So the driving questions here are:
* If the data is going to be specialized anyway can we use Proxies to move the complexity into it rather than the rendering while keeping the appearance simple?
* Can this free up existing constraints on how you modularize your view code?
* Does this approach ultimately provide more adaptibility while reducing the API surface?
* Is fine grained change detection fundamentally more performant than the Virtual DOM?

Admittedly it takes a strong reason to not go with the general consensus of best, and most supported libraries and frameworks. And React's Hooks API addresses the majority of what I once considered it's most untenable faults. But I believe there is a better way out there than how we do it today.

I cover this in more detail in my Bring Your Own Framework Blog Series.

## Blog Series
* [Part 1: Writing a JS Framework in 2018](https://medium.com/@ryansolid/b-y-o-f-part-1-writing-a-js-framework-in-2018-b02a41026929)
* [Part 2: Web Components as Containers](https://medium.com/@ryansolid/b-y-o-f-part-2-web-components-as-containers-85e04a7d96e9)
* [Part 3: Change Management in JavaScript Frameworks](https://medium.com/@ryansolid/b-y-o-f-part-3-change-management-in-javascript-frameworks-6af6e436f63c)
* Part 4 & 5: <i>Coming Soon</i>

## Documentation

* [State](../master/documentation/state.md)
* [Signals](../master/documentation/signals.md)
* [Rendering](../master/documentation/rendering.md)
* [API](../master/documentation/api.md)

## Examples

* [Counter](https://codepen.io/ryansolid/pen/XxpZLX/?editors=1000#0) on CodePen
* [Simple Todos](https://codepen.io/ryansolid/pen/ZqLoxo?editors=1000) on CodePen
* [TodoMVC](https://github.com/ryansolid/solid-todomvc)
* [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/solid)

## Related Projects

* [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)
The renderer behind Solid.js that enables lightning fast fine grained performance.
* [React Solid State](https://github.com/ryansolid/react-solid-state)
React Hooks API to use Solid.js paradigm in your existing React apps.
* [Solid Components](https://github.com/ryansolid/solid-components)
Extensions to Solid.js that add a Web Component wrapper, Portals, and a Context API.
* [S.js](https://github.com/adamhaile/S) The fine grained change detection engine that drives all computations and tracks all dependencies.

## Status

This project is still a work in progress. Do not use in production. I am still refining the API.
