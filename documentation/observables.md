# Observables

Observables are the glue that hold the library together. They often are invisible but interact in very powerful ways that you get more familiar with Solid they unlock a lot of potential. So consider this an intermediate to advanced topic.

### Observable

This is Observable as defined by the [TC39 Proposal](https://github.com/tc39/proposal-observable). These are a standard way of representing streams, and follow a few key conventions. Mostly that they are cold, unicast, and push-based by default. What this means is that they do not do anything until subscribed to at which point they create the source, and do so for each subscription. So if you had an Observable from a DOM Event, subscribing would add an event listener for each function you pass. In so being unicast they aren't managing a list of subscribers. Finally being push you don't ask for the latest value, they tell you.

However, this behavior from a UI perspective is a bit undesireable, sort of unexpected, and gets in the way of the function of this library. In Solid.js we like our Observables to be hot and multicast. Luckily its easy conversion that we do at all points we accept Observables.  We do a conversion anyway to expose our Observables to pull-based interfaces, like State and computations so their dependencies can be automatically tracked. We call these pullable observables Signals.

### Computation

A computation is calculation over a function execution that automatically dynamically tracks it's dependencies. In Solid there are 2 objects that are considered computations, Syncs and Selectors. While serving different purposes they both go through a cycle on execution where they release the previous executions dependencies, then execute grabbing the current dependencies. This constant subscribe and unsubscribe is largely why Cold Observables are no good, and in fact Solid doesn't release the subscription immediately to prevent any unnecessary temporary ripple effects from unsubscribing.

## Sync

This the simplest computation and technically isn't an Observable. It has no ability to be subscribed to, and doesn't notify change. Instead it just runs to keep things in sync when ever changes occur. This is the core piece used in rendering where side effects are necessary (ie.. rendering or updating the DOM) and have a low overhead of execution. They run immediately when created, and every time there after as dependencies change. They are also useful for debugging state changes.

```js
import { Sync, State } from 'solid-js';

state = new State({count: 1});

new Sync(() => {
  console.log(state.count);
});
state.set({count: state.count + 1});

// 1
// 2
```

By default Sync execution is defered to the next Microtask to reduce unnecessary recalculation but this can be controlled by the second argument options.

```js
new Sync(() => ...., {defer: false})
```

## Signals

These are the most primitive of the Observables in Solid, and resemble BehaviorSubjects in RxJS. They are multicast, and have no provider of data. Instead the next method is called on them manually to push updates to subscribers. Their value can be fetched from their value property useful for computations. The can manually be subscribed to as any other Observable.

```js
import { S } from 'solid-js'

const name$ = S('John');
new Sync(() => {
  console.log(name$.value);
});

name$.next('Jane');

// John
// Jane
```

Its important to note this factory treats all non-Observables, non-Promises as basic values. An array is just an array. Combine with other libraries if you need to use more complicated streams.

## Selectors

These computations are also Observables. They are pure functions that allow the merging of mapping of several observable values. They are similar to combineLatest in RxJS except the dependencies aren't explicit and they also behave like flatMap. They support asynchronous return types allowing them to be the only method used in most places and are key to the state.select method.

```js
import { S, State } from 'solid-js'

const state = new State({count: 1});

const countx3$ = S(() => state.count * 3);
new Sync(() => {
  console.log(countx3$.value);
});

state.set({count: state.count + 1});

// 3
// 6
```

Selectors as dynamic multi-tracking map functions are very powerful without resorting to chaining/composing operators. You can represent pretty much any operator using them which makes them a strong fallback for any solution.

They have a few conventions. They by default don't notify changes on equal primitive values. If you want that behavior you need to pass {notifyAlways: true} to the send options parameter of S.

Returning 'undefined' is considered not a value and does not notify. If you want to notify use 'null'. This is useful for filtering or no-op scenarios as well as tracking data initialization.

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
const actions$ = S()
const store$ = S((state = {list: []}) => reducer(state, actions$.value));

// subscription and dispatch
store$.subscribe(({list}) => console.log(list));
actions$.next({type: 'LIST/ADD', payload: {id: 1, title: 'New Value'}})
```

## Streams

These are wrappers of existing of Observables and Promises. They trigger on changes to the underlying object and have all the characteristics of Signals.

```js
import { S } from 'solid-js'

delaySec = new Promise((resolve) => {
  setTimeout(resolve, 1000)
}).then(() => 5);

delayedVal$ = S(delaySec)
new Sync(() => {
  console.log(delayedVal$.value);
});

// undefined
// 5                   after 1000ms
```

## Operators

Operators in Solid are functionally composable or pipeable(RxJS) and constructed using currying. They all take their arguments and return a function that takes a function, Observable, or Promise. In so when using Solid you may find you aren't explicitly using the Signal factory as much as you might expect although basic operators are available as chain syntax on Solid observables.

```js
import { S, State, map } from 'solid-js'

state = new State({name: 'Heather', count: 1});

// single expression
upperName$ = map((name) => name.toUpperCase())(() => state.name)

// in steps
reverseName = map((name) => name.reverse())
reverseUpperName$ = reverseName(upperName$)

// chain syntax
reverseUpperNameChained$ = S(() => state.name)
  .map((name) => name.toUpperCase())
  .map((name) => name.reverse())
```

Solid.js only contains a very small subset of operators helpful for rendering or connecting other observable libraries. If you require more operators it's recommended to write your own or use with a more complete library like RxJS.

Current operators:

### map((item) =>....)
Maps a value to a new value.

### memo((item) =>....)
Memoized map useful for rendering. It returns existing mapped value if input value hasn't changed and clears on false values. Maps to values or items in a Array depending on the data type.

### pipe(...obsv)
This composes a sequence of operators into a single operator.

## Advanced

For those who still need more flexibility there is the ability to extend to create your own Observables and Operators.

### Creating Observable

Streams are driven off of a producer, so it is also possible to write a custom Producer. Producers have start/stop methods to control the stream. You can access _ prefixed versions of the observer properties to propogate events through the stream.

```js
function fromEvent(el, eventName) {
  var handler;
  return {
    start(stream) {
      handler = stream._next.bind(stream);
      el.addEventListener(eventName, handler);
    }

    stop() {
      el.removeEventListener(eventName, handler);
      handler = null;
    }
  }
}

S(fromEvent(window, 'resize'))
```

### Creating a custom pipeable operator

It is not difficult to write your own:

```js
import { S, pipe } from 'solid-js'

function filter(filterFn) {
  return (source) =>
    S(source).map((value) => {
      if (fn(value)) return value;
      return;
    })
}

state = new State({number: 2});

<div>{
  S(() => state.number).pipe(
    filter((num) => num % 2 === 0)
    map((num) => `${num} is even.`)
  )
}</div>

state.set({number: 3}); // will be skipped in display
state.set({number: 6});
```