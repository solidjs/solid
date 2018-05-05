# Solid.js

Solid.js is yet another declaritive Javascript library for creating user interfaces.  It does not use the Virtual DOM. Instead it opts to compile it's templates down to real DOM nodes and wrap updates in fine grained computations.

### Key Features:
* Real DOM with fine grained change detection (<b>No Virtual DOM! No Dirty Checking Digest Loop!</b>)
* JSX precompilation with support for standard JSX features and W3C Web Components
* Declarative data
  * Data behavior is part of the declaration
  * No need for lifecycle functions, and the large chains of conditionals they bring.
* ES6 Proxies to keep data access simple and POJO like
* Promises and ES Observables are first class citizens:
  * Easy interopt with existing libraries that manage services and state
  * All computations and bindings when resolved to these automatically update asynchronously allowing for 100% pure data declarations.
* Truly just a render library
  * Unopinionated about how you set modularize/componentize your code
  * The whole tree is only rendered once so statefulness is not a decider for the use of functional components
  * Use familiar techniques like HOCs, Class inheritance, dependency injection as you see fit.
* Performance on par with the fastest Virtual DOM libraries

<br />
A Simple Component could look like:

    import Solid, { State } from 'solid-js'

    function MyComponent() {
      state = new State({
        users: [{
          id: 1, firstName: 'John', lastName: 'Smith'
        }, {
          id: 2, firstName: 'Jane', lastNameL 'Smith'
        }]
      });

      return (<>
        <h1>Welcome</h1>
        <ul>{
          state.users.map(user => <li>{user.firstName} {user.lastName}</li>)
        }</ul>
      </>);
    }

    Solid.root(=>
      mountEl.appendChild(MyComponent())
    );

## Solid State

It all starts with a State object. These objects can represent the local state or the props in your components. State objects look like plain javascript options except to control change detection you call their set method.

    var state = new State({counter: 0});
    state.set({
      counter: state.counter + 1
    });

You can also deep set:

    var state = new State({
      user: {
        firstName: 'John'
        lastName: 'Smith'
      }
    });

    state.set('user', {firstName: 'Jake', middleName: 'Reese'});

The use of the function allows for more control over the access to update the state object and is the key to reducing the use of unnecessary Proxies to allow for greater performance.

But where the magic happens is with making computations. This done through State's select method which takes an Observable, a Promise, or a Function and maps it to a state property. The simplest form of passing a function will wrap it in our Selector Observable which is a computation that automatically tracks dependencies.

    state.select({
      displayName: () => {
        return `${state.user.firstName} ${state.user.lastName}`;
      }
    })

    console.log(state.displayName); // Jake Smith

Whenever any dependency changes the State value will immediately update. Internally all JSX expressions also get wrapped in computations so for something as trivial as a display name you could just inline the expression in the template and have it update automatically.

This is also primary mechanism to interopt with store technologies like Redux, Apollo, RxJS which expose themselves as Observables or Promises. When you hook up these selectors you can use standard methods to map the properties you want and the State object will automatically diff the changes to only affect the minimal amount.

    props.select({
      myCounter: Observable.from(store).map(({counter}) => counter)
    })

## Solid Rendering

To accomplish rendering we use JSX for templating that gets compiled to native DOM element instructions. To do that we take advantage of the babel-plugin-jsx-dom-expressions which while converting JSX to DOM element instructions wraps expressions to be wrapped in our computeds.

JSX as a templating language brings a lot of benefits. The just being javascript goes beyond just not needing a DSL, but setting up closure based context instead of creating context objects. This is both much more performant and uses considerable less memory. The well defined AST lends well to precompilation. This works so well it almost feels like cheating. I believe it's a big part of bringing the same level of tooling to fine grained change detection libraries already enjoyed by Virtual DOM libraries.

To get setup add this babel plugin config to your .babelrc, webpack, or rollup config:

    "plugins": [["jsx-dom-expressions", {"noWhitespaceOnly": true, "moduleName": "Solid"}]]

## Why?

This project started as trying to find a small performant library to work with Web Components, that had easy interopt with existing standards. It is very inspired by fine grain change detection libraries like Knockout.js and the radical approach taken by Cycle.js. I feel the API for those were a considerable barrier. At the same time, for all the really good things that came with React and the Virtual DOM evolution of UI frameworks it also felt like a bit of a step backwards.

* The VDOM render while performant is still conceptually a constant re-render
  * It feels much more imperative as variable declarations and iterative methods for constructing the tree are constantly re-evaluating
* Reintroduced lifecycle function hell that break apart the declarative nature of the data. Ex. relying on blacklisting changes across the tree with shouldComponentUpdate.
* Homogenous promise of Components and the overly simplistic local state in practice:
  * Imposes boundaries on components to solve performance concerns
  * Prices you into a very specific but not necessarily obvious structure
  * Only served to make it more ambiguous when emerging best practices lead to specialized component classification anyway
* VDOM libraries still are based around having a specialized data objects.

So the driving questions here are:
* If the data is going to be specialized anyway can we use Proxies to move the complexity into it rather than the rendering while keeping the appearance simple?
* Can this free up existing constraints on how you modularize your view code?
* Does this approach ultimately provide more adaptibility while reducing the API surface?
* Is fine grained change detection fundamentally more performant than the Virtual DOM?

Admittedly it takes a strong reason to not go with the general consensus of best, and most supported libraries and frameworks. But I believe there is a better way out there than how we do it today.

## Documentation

* [Data Types](../master/documentation/data-types.md)
* [Components](../master/documentation/components.md)
* [Mutability](../master/documentation/mutability.md)
* [Scheduling](../master/documentation/scheduling.md)

## Status

This project is still a work in progress. Although I've been working on it for the past 2 years it's been evolving considerably. I've decided to open source this at this point to share the concept. It took discovering the approaches used by Surplus.js to fill the missing pieces this library needed to prove out it's concept. And now I believe we can have performance and a simple clean API. The focus has been API, correctness, performance, compatibility, in that order so there is a lot of work to be done.

Areas of Improvement:
* Tests
* Documentation
* Compile time optimization
* Run time optimization
* Examples