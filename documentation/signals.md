# Signals

Signals are the glue that hold the library together. They often are invisible but interact in very powerful ways that you get more familiar with Solid they unlock a lot of potential. So consider this an intermediate to advanced topic.

At it's core Solid uses [S.js](https://github.com/adamhaile/S) to propagate it's change detection. Signals are a simple primitive that contain values that change over time. With Signals you can track sorts of changes from various sources in your applications. You can create a Signal manually or from any Async source.

```js
import S from 's-js';

function fromInterval(delay) {
  var s = S.data(0);
      handle = setInterval(() => s(s() + 1), delay);
  S.cleanup(() => clearInterval(handle))
  return s;
}
```
Solid comes with a from operator that automatically handles creating Signals from functions, promises, and observables.

### Computation

A computation is calculation over a function execution that automatically dynamically tracks it's dependencies. A computation goes through a cycle on execution where it releases its previous execution's dependencies, then executes grabbing the current dependencies. You can create a computation by passing a function into state.select and any of Solid's operators.

```js
import S from 's-js';
import { State } from 'solid-js';

state = new State({count: 1});

S(() => console.log(state.count));
state.set({count: state.count + 1});

// 1
// 2
```

They also pass the previous value on each execution. This is useful for reducing operations (obligatory Redux in a couple lines example):

```js
const reducer = (state, action) => {
  switch(action.type) {
    case 'LIST/ADD':
      return {...state, list: [...state.list, action.payload]};
    default:
      return state;
  }
}

// redux
const action = S.data()
const store = S(state => reducer(state, action()),  {list: []});

// subscribe and dispatch
S(() => console.log(store().list));
action({type: 'LIST/ADD', payload: {id: 1, title: 'New Value'}});
```
That being said there are plenty of reasons to use actual Redux. And since a Redux Store exports an Observable it's just a map function away from passing into a State Selector in Solid to use in your components.

### Observable

Signals and Observable are similar concepts that can work together but there are a few key differences. Observables are as defined by the [TC39 Proposal](https://github.com/tc39/proposal-observable). These are a standard way of representing streams, and follow a few key conventions. Mostly that they are cold, unicast, and push-based by default. What this means is that they do not do anything until subscribed to at which point they create the source, and do so for each subscription. So if you had an Observable from a DOM Event, subscribing would add an event listener for each function you pass. In so being unicast they aren't managing a list of subscribers. Finally being push you don't ask for the latest value, they tell you.

Observables track next value, errors, and completion. This is very useful for tracking discreet events over time. Signals are much simpler. They are hot and multicast in nature and while capable of pushing values over time aren't aware of it themselves. They are simple and synchronous. They don't complete, they exist or they don't exist.

Observables can work well with Signals as being a source that feeds data into them. Like State, Observables are another tool that allow more control in a specific aspect of your application. Where State is valuable for reconciling multiple Signals together into a serializable structure to keep managing Component or Storage code simple, Observables are useful for transforming Async data pipelines like handling Data Communication services.

## Operators

Operators in Solid are functionally composable or pipeable and constructed using currying. They all take their arguments and return a function that takes a function, Observable, or Promise. In so when using Solid you may find you aren't explicitly using the Signal factory as much as you might expect.

```js
import { State, map } from 'solid-js'

state = new State({name: 'Heather', count: 1});

// single expression
upperName$ = map((name) => name.toUpperCase())(() => state.name)

// in steps
reverseName = map((name) => name.reverse())
reverseUpperName$ = reverseName(upperName$)
```

Solid.js only contains a very small subset of operators helpful for rendering or connecting other observable libraries. If you require more operators it's recommended to write your own or use with a more complete library like RxJS.

Current operators:

### map((value) =>....)
Maps a value to a new value.

### memo((item) =>....)
A super mapper for rendering, memo is a memoized map that returns previously mapped value if input value is the same. It automatically splits across arrays and clears on falsey values.

### pipe(...operators)
This composes a sequence of operators into a single operator.

### from(fn|observable|promise)
No-op for fn's, but ensures observables/promises are made into a Signal.

### observable(s)
Returns a minimal observable implementation.

To write your own pipeable operator involves creating a function that returns a function that takes a thunk and returns a new thunk. Generally it looks like this:

```js
import { pipe, map } from 'solid-js';

function someOperator(...someArguments) {
  return function(input) {
    return () =>
      //...do some calculation based on input
      // return fn(input())
  }
}

// now you can use it in a pipe
var s = S.data(),
  someArguments; //whatever they are

pipe(
  map(i => i)
  someOperator(someArguments)
)(s);
```