# Solid.js

Solid.js is yet another declaritive Javascript library for creating user interfaces.  It is unopinionated about how you organize your code and focuses on synchronizing local state and keeping the DOM up to date. Unlike make popular recent libraries it does not use the Virtual DOM. Instead it opts to compile it's templates down to real DOM nodes and wrap updates in fine grained computations.

The project started as trying to find a small performant library to work with Web Components, that had easy interopt with existing technologies. This library is very inspired by Knockout.js and Surplus.js, but seeks to provide an interface that is more familiar to people used to using virtual DOM libraries.

To that end this library is based on solely 3 things: JSX precompilation, ES2015 Proxies, and the TC-39 Observable proposal.

A Simple Component could look like:

import Solid, { State } from 'solid-js'

    MyComponent() {
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
          state.users.map(user => {
            <li>{user.firstName} {user.lastName}</li>
          }
        }</ul>
      </>);
    }

    Solid.root(=>
      mountEl.appendChild(MyComponent())
    );

## Solid State

It all starts with a State object. State objects look like plain javascript options except to control change detection you call their set method.

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

But where the magic happens is with making computations. This done through State's select method which takes an Observable, a Promise, or a Function and maps it to a state property. The simplest form of passing a function will wrap it in our Selector Observable which is a computation that automatically tracks dependencies.

    state.select({
      displayName: () => {
        return `${state.user.firstName} ${state.user.lastName}`;
      }
    })

    console.log(state.displayName); // Jake Smith

The way this works is that the State instance is the entry point. When working in your setup code and event handlers you will be just dealing with plain POJO javascript objects. However inside a computation the State instance will return nested proxies to track gets, and so on. In the case of a render tree even if the State root object doesn't make it all the way down as long as you fetch it originally off your state from with the render it will start tracking.

Truthfully for something as trivial as a display name you wouldn't necessarily need a selector and could just inline the expression in the template. But this really comes in handy for reuse and more complicated scenarios. And can be the primary mechanism to interopt with store technologies like Redux, Apollo, RxJS which expose themselves as observables. When you hook up these selectors you can use standard methods to map the observables to grab the properties you want and the State object will automatically diff the changes to only affect the minimal amount.

    state.select({
      myCounter: Observable.from(store).map(({counter}) => counter)
    })

There is also a replace method for state which instead of merging values swaps them out.

## Solid Rendering

So to accomplish rendering we use JSX for templating that gets compiled to native DOM element instructions. To do that we take advantage of the babel-plugin-jsx-dom-expressions which while converting JSX to DOM element instructions wraps expressions to be wrapped in our computeds.

JSX as a templating language brings a lot of benefits. The just being javascript goes beyond just not needing a DSL, but setting up closure based context instead of creating context objects. This is both much more performant and uses considerable less memory. The well defined AST lends well to precompilation. This works so well it almost feels like cheating. I believe it's a big part of bringing the same level of tooling to fine grained change detection libraries already enjoyed by Virtual DOM libraries.

## Components

Solid.js doesn't have an opinion how you want to modularize your code. You can use objects, classes, or composable functions. Since the core render routine only runs once function closures are sufficient to maintain state. The library was made in mind for Web Components though.

You could imagine making a base Component class that creates a State instance for the internal state and props, which the child then inherits. In that model Solid would look very similar to somthing like React.

    class Component {
      constructor () {
        this.state = new State({})
        this.props = new State({});
      }

      connectedCallback() {
        this.attachShadow({mode: 'open'});
        Solid.root(() => this.shadowRoot.appendChild(this.render());
      }

      attributeChangedCallback(attr, oldVal, newVal) {
        this.props.replace(attr, newVal);
      }
    }

    class MyComponent extends Component {
      constuctor () {
        @state.set({greeting: 'World'});
      }
      render() {
        <div>Hello {state.greeting}</div>
      }
    }

But functional composition is just as fair game.

    Component(fn) {
      state = new State({});
      props = new State({});
      fn({state, props});
    }

    MyComponent({state}) {
      state.set({greeting: 'World'});
      return (<div>Hello {state.greeting}</div>);
    }

    Solid.root(() =>
      element.appendChild(Component(MyComponent))
    );

## Why?

For all the really good things that came with React and the Virtual DOM evolution of declarative JS UI frameworks it also felt like a bit of a step backwards. And I don't mean the backlash people had with JSX etc..

The thing is for all it's differences the VDOM libraries like React still are based around having a special data object even if they push the complexity to under the hood of rendering. The trade off is lifecycle functions that break apart the declarative nature of the data. At an extreme relying on blacklisting changes in multiple places for shouldComponentUpdate. Imposed boundaries on components to sate performance concerns. A UI model that rerenders every loop that while relatively performant conceptually is at odds with what you see is what you get (it's not a mutable declaration but a series of imperative functions).

So the proposition here is if the data is going to be complicated anyway can we use Proxies to move the complexity into it rather than the rendering. And through using standard reactive interopt we can play we can invite playing nice with others rather push the interopt point in userland.

## Status

This project is still a work in progress. Although I've been working on it for the past 2 years it's been evolved considerably. I've decided to open source this at this point to share the concept. It took discovering the approaches used by Surplus.js to fill the missing pieces this library needed to prove out it's concept. And now I believe we can have performance and Proxies.

I will be publishing some examples.  And need to work more on Tests/Compatibility/Documenting the rest of the libary.