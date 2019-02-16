# Signals

Signals are the glue that hold the library together. They often are invisible but interact in very powerful ways that you get more familiar with Solid they unlock a lot of potential.

At it's core Solid uses [S.js](https://github.com/adamhaile/S) to propagate it's change detection. Signals are a simple primitive that contain values that change over time. With Signals you can track sorts of changes from various sources in your applications. Solid's State object is built from a Proxy over a tree of Signals. You can update a Signal manually or from any Async source.

```js
import { createSignal, onCleanup } from 'solid-js';

function useTick(delay) {
  const [getCount, setCount] = createSignal(0);
    handle = setInterval(() => setCount(getCount() + 1), delay);
  onCleanup(() => clearInterval(handle));
  return getCount;
}
```

### Accessors & Context

Signals are special functions that when executed return their value. Accessors are just functions that "access", or read a value from one or more Signals. At the time of reading the Signal the current execution context (a computation) has the ability to track Signals that have been read, building out a dependency tree that can automatically trigger recalculations as their values are updated. This can be as nested as desired and each new nested context tracks it's own dependencies. Since Accessors by nature of being composed of Signal reads are too reactive we don't need to wrap Signals at every level just at the top level where they are used and around any place that is computationally expensive where you may want to memoize or store intermediate values.

### Computations

An computation is calculation over a function execution that automatically dynamically tracks any dependent signals. A computation goes through a cycle on execution where it releases its previous execution's dependencies, then executes grabbing the current dependencies.

There are 2 main computations used by Solid: Effects which produce side effects, and Memos which are pure and return a read-only Signal.

```js
import { createState, createEffect } from 'solid-js';

const [state, setState] = createState({count: 1});

createEffect(() => console.log(state.count));
setState({count: state.count + 1});

// 1
// 2
```

Memos also pass the previous value on each execution. This is useful for reducing operations (obligatory Redux in a couple lines example):

```js
const reducer = (state, action = {}) => {
  switch(action.type) {
    case 'LIST/ADD':
      return {...state, list: [...state.list, action.payload]};
    default:
      return state;
  }
}

// redux
const [getAction, dispatch] = createSignal(),
  getStore = createMemo(state => reducer(state, getAction()), {list: []});

// subscribe and dispatch
createEffect(() => console.log(getStore().list));
dispatch({type: 'LIST/ADD', payload: {id: 1, title: 'New Value'}});
```
That being said there are plenty of reasons to use actual Redux.

### Rendering

You can also use signals directly. As an example, the following will show a count of ticking seconds:

```jsx
import { createRoot, createSignal } from 'solid-js'

createRoot(() => {
  const [getSeconds, setSeconds] = createSignal(0);
    div = <div>Number of seconds elapsed: {( getSeconds() )}</div>

  setInterval(() => setSeconds(getSeconds() + 1), 1000)
  document.body.appendChild(div)
})
```

### Composition

State and Signals combine wonderfully as wrapping a state selector in a function instantly makes it reactive accessor. They encourage composing more sophisticated patterns to fit developer need.

```js
// deep reconciled immutable reducer
const useReducer = (reducer, init) => {
  const [state, setState] = createState(init),
    [getAction, dispatch] = createSignal();
  createEffect((prevState = init) => {
    let action, next;
    if (!(action = getAction())) return prevState;
    next = reducer(prevState, action);
    setState(reconcile(next));
    return next;
  }, [ getAction ])
  return [state, dispatch];
}
```

### Observable

Signals and Observable are similar concepts that can work together but there are a few key differences. Observables are as defined by the [TC39 Proposal](https://github.com/tc39/proposal-observable). These are a standard way of representing streams, and follow a few key conventions. Mostly that they are cold, unicast, and push-based by default. What this means is that they do not do anything until subscribed to at which point they create the source, and do so for each subscription. So if you had an Observable from a DOM Event, subscribing would add an event listener for each function you pass. In so being unicast they aren't managing a list of subscribers. Finally being push you don't ask for the latest value, they tell you.

Observables track next value, errors, and completion. This is very useful for tracking discreet events over time. Signals are much simpler. They are hot and multicast in nature and while capable of pushing values over time aren't aware of it themselves. They are simple and synchronous. They don't complete, they exist or they don't exist.

Observables can work well with Signals as being a source that feeds data into them. Like State, Observables are another tool that allow more control in a specific aspect of your application. Where State is valuable for reconciling multiple Signals together into a serializable structure to keep managing Component or Store code simple, Observables are useful for transforming Async data pipelines like handling Data Communication services.
