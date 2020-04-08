# Signals

Signals are the glue that hold the library together. They often are invisible but interact in very powerful ways that you get more familiar with Solid they unlock a lot of potential.

Signals are a simple primitive that contain values that change over time. With Signals you can track sorts of changes from various sources in your applications. Solid's State object is built from a Proxy over a tree of Signals. You can update a Signal manually or from any Async source.

```js
import { createSignal, onCleanup } from "solid-js";

function useTick(delay) {
  const [getCount, setCount] = createSignal(0),
    handle = setInterval(() => setCount(getCount() + 1), delay);
  onCleanup(() => clearInterval(handle));
  return getCount;
}
```

## Accessors & Context

Signals are special functions that when executed return their value. Accessors are just functions that "access", or read a value from one or more Signals. At the time of reading the Signal the current execution context (a computation) has the ability to track Signals that have been read, building out a dependency tree that can automatically trigger recalculations as their values are updated. This can be as nested as desired and each new nested context tracks it's own dependencies. Since Accessors by nature of being composed of Signal reads are too reactive we don't need to wrap Signals at every level just at the top level where they are used and around any place that is computationally expensive where you may want to memoize or store intermediate values.

## Computations

An computation is calculation over a function execution that automatically dynamically tracks any dependent signals. A computation goes through a cycle on execution where it releases its previous execution's dependencies, then executes grabbing the current dependencies.

There are 2 main computations used by Solid: Effects which produce side effects, and Memos which are pure and return a read-only Signal.

```js
import { createState, createEffect } from "solid-js";

const [state, setState] = createState({ count: 1 });

createEffect(() => console.log(state.count));
setState({ count: state.count + 1 });

// 1
// 2
```

Memos also pass the previous value on each execution. This is useful for reducing operations (obligatory Redux in a couple lines example):

```js
const reducer = (state, action = {}) => {
  switch (action.type) {
    case "LIST/ADD":
      return { ...state, list: [...state.list, action.payload] };
    default:
      return state;
  }
};

// redux
const [getAction, dispatch] = createSignal(),
  getStore = createMemo(state => reducer(state, getAction()), { list: [] });

// subscribe and dispatch
createEffect(() => console.log(getStore().list));
dispatch({ type: "LIST/ADD", payload: { id: 1, title: "New Value" } });
```

That being said there are plenty of reasons to use actual Redux.

## Cleanup

While Solid does not have Component lifecyles in the traditional sense, it still needs to handle cleaning up subscriptions. The way Solid works is that each part of the graph is owned by it's parent context. In so all commputations must be created as part of a root. This detail is generally taken care of for you as the `render` method contains a `createRoot` call. But it can be called directly for cases where it makes sense.

Once inside a context whenever the context is re-evaluated or disposed of itself, all children computations will be disposed. In addition you can register a `onCleanup` method that will execute as part of this disposal cycle.

Note: _Solid's graph is synchronously executed so any starting point that isn't caused by a reactive update (perhaps an asynchronous entry) should start from its own root. There are other ways to handle asynchronicity as shown in the [Suspense Docs](./supense.md)_

## Rendering

You can also use signals directly. As an example, the following will show a count of ticking seconds:

```jsx
import { createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/dom";

render(() => {
  const [seconds, setSeconds] = createSignal(0),
    handler = setInterval(() => setSeconds(seconds() + 1), 1000);
  onCleanup(() => clearInterval(handler));
  return <div>Number of seconds elapsed: {seconds()}</div>;
}, document.body);
```

## Composition

State and Signals combine wonderfully as wrapping a state selector in a function instantly makes it reactive accessor. They encourage composing more sophisticated patterns to fit developer need.

```js
// deep reconciled immutable reducer
const useReducer = (reducer, init) => {
  const [state, setState] = createState(init),
    [getAction, dispatch] = createSignal();
  createDependentEffect(
    (prevState = init) => {
      let action, next;
      if (!(action = getAction())) return prevState;
      next = reducer(prevState, action);
      setState(reconcile(next));
      return next;
    },
    [getAction]
  );
  return [state, dispatch];
};
```

## Operators

Solid provides a couple simple operators to help construct more complicated behaviors. They work both as standalone and curried Functional Programming form, where they return a function that takes the input accessor. They are not computations themselves and are designed to be passed into `createMemo`. The possibilities of operators are endless. Solid only ships with a base array mapping one:

### `mapArray(() => any[], iterator: (item, index) => any, options: { fallback: () => any }): () => any[]`

### `mapArray(iterator: (item, index) => any, options: { fallback: () => any }): (signal) => () => any[]`

The `solid-rx` package contains more operators that can be used with Solid.
