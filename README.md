# Solid.js

Solid.js is yet another declaritive Javascript library for creating user interfaces.  It does not use the Virtual DOM. Instead it opts to compile it's templates down to real DOM nodes and wrap updates in fine grained computations.

### Key Features:
* Real DOM with fine grained change detection (<b>No Virtual DOM! No Dirty Checking Digest Loop!</b>)
* JSX precompilation with support for standard JSX features and W3C Web Components
* Declarative data
  * Data behavior is part of the declaration
  * No need for lifecycle functions, and the large chains of conditionals they bring.
* ES6 Proxies to keep data access simple and POJO like
* Easy Promises and ES Observables interoptability:
  * Easy interopt with existing libraries that manage services and state.
* Expandable custom operators and binding directives.
* Truly just a render library
  * Unopinionated about how you set modularize/componentize your code
  * The whole tree is only rendered once so statefulness is not a decider for the use of functional components
  * Use familiar techniques like HOCs, Class inheritance, dependency injection as you see fit.
* Performance amongst the fastest libraries. See Solid on [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark)

<br />
A Simple Component could look like:

```jsx
import { useState, root } from 'solid-js'

function MyComponent() {
  const [state, setState] = useState({
    users: [{
      id: 1, firstName: 'John', lastName: 'Smith'
    }, {
      id: 2, firstName: 'Jane', lastName: 'Smith'
    }]
  });

  return (<>
    <h1>Welcome</h1>
    <ul>{
      state.users.map(user => <li>{( user.firstName )} {( user.lastName )}</li>)
    }</ul>
  </>);
}

root(() => mountEl.appendChild(<MyComponent />));
```

## Installation

```sh
> npm install solid-js s-js babel-plugin-jsx-dom-expressions
```

## Solid State

It all starts with a State object. These objects can represent the local state or the props in your components. State objects look like plain javascript options except to control change detection you call their setter method. They give the control of an immutable interface and the performance of a mutable one.

```js
const [state, setState] = useState({counter: 0});
setState({
  counter: state.counter + 1
});
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
  cleanup(() => disposable.unsubscribe());
});
```

## Solid Rendering

To accomplish rendering we use JSX for templating that gets compiled to native DOM element instructions. To do that we take advantage of the [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) which while converting JSX to DOM element instructions wraps expressions to be wrapped in our computeds.

JSX as a templating language brings a lot of benefits. The just being javascript goes beyond just not needing a DSL, but setting up closure based context instead of creating context objects. This is both much more performant and uses considerable less memory.

To get setup add this babel plugin config to your .babelrc, webpack, or rollup config:

```js
"plugins": ["jsx-dom-expressions"]
```

And include at the top of your files:

```js
import { r } from 'solid-js/dom'
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

## Documentation

* [State](../master/documentation/state.md)
* [Components](../master/documentation/components.md)
* [Signals](../master/documentation/signals.md)
* [Operators](../master/documentation/operators.md)
* [Rendering](../master/documentation/rendering.md)

## Examples

* [Counter](https://codepen.io/ryansolid/pen/XxpZLX/?editors=1000#0) on CodePen
* [Simple Todos](https://codepen.io/ryansolid/pen/ZqLoxo?editors=1000) on CodePen
* [TodoMVC](https://github.com/ryansolid/solid-todomvc)
* [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/solid)

## Related Projects

* [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)
The renderer behind Solid.js that enables lightning fast fine grained performance.
* [S.js](https://github.com/adamhaile/S) The fine grained change detection engine that drives all computations and tracks all dependencies.
* [React Solid State](https://github.com/ryansolid/react-solid-state)
A local state swap in for React to use Solid.js paradigm in your existing React apps.
* [Solid Components](https://github.com/ryansolid/solid-components)
Extensions to Solid.js that add a Web Component wrapper, Portals, and a Context API.

## Status

This project is still a work in progress. Do not use in production. I am still refining the API.
