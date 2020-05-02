# Reactivity

## Signals

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

## Accessors Reactive Scope

Signals are special functions that when executed return their value. In addition they are trackable when executed under a reactive scope. This means that when their value read (executed) the currently executing reactive scope is now subscribed to the Signal and will re-execute whenever the Signal is updated.

This mechanism is based on executing function scope so Signals reads can be composed and nested as many levels as desired. By wrapping a Signal read in a thunk `() => signal()` you have effectively created a higher-order signal that can be tracked as well. These accessors are just functions that can be tracked and return a value. No additional primitive or method is needed for them to work as Signals in their own right. However, you need another primitive to make Signals reactive:

## Computations

An computation is calculation over a function execution that automatically dynamically tracks any child signals. A computation goes through a cycle on execution where it releases its previous execution's dependencies, then executes grabbing the current dependencies.

There are 2 main computations used by Solid: Effects which produce side effects, and Memos which are pure and designed to cache values until their reactivity forces re-evaluation.

```js
import { createSignal, createEffect, createMemo } from "solid-js";

const [count, setCount] = createSignal(1),
  doubleCount = createMemo(() => count() / 2)
createEffect(() => console.log(doubleCount()));
setCount(count() + 1);

// 2
// 4
```

Keep in mind memos are only necessary if you wish to prevent re-evaluation when the value is pulled. Useful for expensive operations like DOM Node creation. Any example with a memo could also just be a function and effectively be the same without caching.

```js
import { createSignal, createEffect } from "solid-js";

const [count, setCount] = createSignal(1),
  doubleCount = () => count() / 2
// No memo still works
createEffect(() => console.log(doubleCount()));
setCount(count() + 1);

// 2
// 4
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

## Rendering with Reactivity

Solid makes use of it's reactive lifecycle to render the DOM. Creating and updating the DOM are seen as side effects of the reactive system and the tree is constructed by nesting Computations wrapping each binding and dynamic insert with one. You can view its execution like a stack where only the top-most computation is tracking at a given time, and so is the only one tracking the reactive change. Since attributes and inserts are tracked separately from the parent scope responsible for rendering a Component in the first place, updates to attributes or downstream nodes do not require the parent to re-evaluate. If the parent ever were it would wipe out all the children and start again. However the only thing that would make that happen is if something upstream changed, like the condition that made it render in the first place. In so when in the synchronous execution path you are always under a reactive context even if it is not tracking (like a `root`).

## Cleanup

While Solid does not have Component lifecyles in the traditional sense, it still needs to handle cleaning up subscriptions. The way Solid works is that each nested computation is owned by it's parent reactive scope. In so all commputations must be created as part of a root. This detail is generally taken care of for you as the `render` method contains a `createRoot` call. But it can be called directly for cases where it makes sense.

Once inside a scope whenever the scope is re-evaluated or disposed of itself, all children computations will be disposed. In addition you can register a `onCleanup` method that will execute as part of this disposal cycle.

Note: _Solid's graph is synchronously executed so any starting point that isn't caused by a reactive update (perhaps an asynchronous entry) should start from its own root. There are other ways to handle asynchronicity as shown in the [Suspense Docs](./supense.md)

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

Solid provides a couple simple operators to help construct more complicated behaviors. They work both as standalone and curried Functional Programming form, where they return a function that takes the input accessor. They are not computations themselves and are designed to be passed into a computation. The possibilities of operators are endless. Solid only ships with a base array mapping one:

### `mapArray(() => any[], iterator: (item, index) => any, options: { fallback: () => any }): () => any[]`

### `mapArray(iterator: (item, index) => any, options: { fallback: () => any }): (signal) => () => any[]`

The `solid-rx` package contains more operators that can be used with Solid.
