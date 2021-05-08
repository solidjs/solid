# Reactivity

Solid's data management is built off a set of flexible reactive primitives which are responsible for all the updates. It takes a very similar approach to MobX or Vue except it never trades its granularity for a VDOM. Dependencies are automatically tracked when you access your reactive values in your Effects and JSX View code.

Solid's primitives come in the form of `create` calls that often return tuples, where generally the first element is a readable primitive and the second is a setter. It is common to refer to only the readable part by the primitive name.

Here is a basic auto incrementing counter that is updating based on setting the `count` signal.

```jsx
import { createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";

const App = () => {
  const [count, setCount] = createSignal(0),
    timer = setInterval(() => setCount(count() + 1), 1000);
  onCleanup(() => clearInterval(timer));

  return <div>{count()}</div>;
};

render(() => <App />, document.getElementById("app"));
```

> **For React Users:** This looks like React Hooks, but it is very different. There are no Hook rules, or concern about stale closures because your Component only runs once. It is only the "Hooks" that re-execute. So they always have the latest references.

## Signals

Signals are the glue that hold the library together. They are a simple primitive that contain values that change over time. Each Signal comes with a separate setter in a tuple. This setter is the only way to update the Signal's value.

With Signals you can track all sorts of changes from various sources in your applications. They are not tied to any specific component and can be used wherever whenever.

```js
import { createSignal, onCleanup } from "solid-js";

function createTick(delay) {
  const [getCount, setCount] = createSignal(0),
    handle = setInterval(() => setCount(getCount() + 1), delay);
  onCleanup(() => clearInterval(handle));
  return getCount;
}
```
## Effects

When we want our Signals to affect the world we use Effects. Effects wrap expressions that contain Signals and re-execute them everytime those Signals change. The most common ones are JSX bindings we can manually create them as well.

```js
import { createSignal, onCleanup } from "solid-js";

function logTick(delay) {
  const [getCount, setCount] = createSignal(0),
    handle = setInterval(() => setCount(getCount() + 1), delay);
  onCleanup(() => clearInterval(handle));

  // logs the count every `delay` interval
  createEffect(() => console.log(getCount()));
}
```

Effects are what allow the DOM to stay up to date. While you don't see them, everytime you write an expression in the JSX(code between the parenthesis `{}`), the compiler is wrapping it in a function and passing it to a `createEffect` call.

## Memos

Wrapping a Signal read in a thunk `() => signal()` creates a derived signal that can be tracked as well. The same holds true for accessing props or Solid's reactive State proxies. Want to use state as a signal just wrap it in a function. Any pure function that wraps one ore more Signal executions is also a Signal.

```js
import { createSignal, createEffect } from "solid-js";

const [count, setCount] = createSignal(1);
const doubleCount = () => count() * 2;

createEffect(() => console.log(doubleCount()));
setCount(count() + 1);

// 2
// 4
```

Memos allow us to store and access values without re-evaluating them until their dependencies change. They are very similar to derived Signals mentioned above except they only re-evaluate when their dependencies change and return the last cached value on read.

Keep in mind memos are only necessary if you wish to prevent re-evaluation when the value is read. Useful for expensive operations like DOM Node creation. Otherwise they are not very different from other Signals.

```js
import { createSignal, createMemo, createEffect } from "solid-js";

const [count, setCount] = createSignal(1);
const expensiveCount = createMemo(() => expensiveCalculation(count()));

createEffect(() => console.log(expensiveCount()));
setCount(count() + 1);
```

Memos also pass the previous value on each execution. This is useful for reducing operations (obligatory Redux in a couple lines example):

```js
// reducer
const reducer = (state, action = {}) => {
  switch (action.type) {
    case "LIST/ADD":
      return { ...state, list: [...state.list, action.payload] };
    default:
      return state;
  }
};

// initial state
const state = { list: [] };

// redux
const [getAction, dispatch] = createSignal(),
  getStore = createMemo(state => reducer(state, getAction()), state);

// subscribe and dispatch
createEffect(() => console.log(getStore().list));
dispatch({ type: "LIST/ADD", payload: { id: 1, title: "New Value" } });
```

That being said there are plenty of reasons to use actual Redux.

## State

Sometimes there is a desire to have deeply nested signals and that is where state comes in. It is composed of many on demand reactive Signals through a proxy object. It is deeply nested reactivity, and lazily creates Signals on demand.

The advantage is that it is automatically reactive and resembles data structures you may already have. It removes the classic issues with fine-grained reactivity around mapping reactive structures and serializing JSON. And as a structure itself it can be diffed allowing interaction with immutable data and snapshots.

Through the use of proxies and explicit setters it gives the control of an immutable interface and the performance of a mutable one.

```jsx
import { createState } from "solid-js";
import { render } from "solid-js/web";

export default function App() {
  const [state, setState] = createState({
    user: {
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${this.firstName} ${this.lastName}`;
      }
    }
  });

  return (
    <div onClick={() => setState("user", "lastName", value => value + "!")}>
      {state.user.fullName}
    </div>
  );
};
```

> Note: State objects themselves aren't reactive. Only the property access on them are. So destructuring in non-tracked scopes will not track updates. Also passing the state object directly to bindings will not track unless those bindings explicitly access properties. Finally, while nested state objects will be notified when new properties are added, top level state cannot be tracked so adding properties will not trigger updates when iterating over keys. This is the primary reason state does benefit from being created as a top level array.
## Managing Dependencies and Updates

Sometimes we want to be explicit about what triggers Effects and Memos to update and nothing else. Solid offers ways to explicitly set dependencies or to not track under a tracking scope at all.

```js
const [a, setA] = createSignal(1);
const [b, setB] = createSignal(1);

createEffect(() => {
  const v = a();
  untrack(() => console.log(v, b()));
}); // 1, 1

setA(2); // 2, 1
setB(2); // (does not trigger)
setA(3); // 3, 2 (still reads latest values)
```

For convenience Solid provides an `on` operator to set up explict dependencies for any computation.

```js
// equivalent to above
createEffect(on(a, v => console.log(v, b())));
```

Solid executes synchronously but sometimes you want to apply multiple changes at once. `batch` allows us to do that without triggering updates multiple times.

```js
batch(() => {
  setA(4);
  setB(6);
});
```

## Cleanup

While Solid does not have Component lifecyles in the traditional sense, it still needs to handle cleaning up reactive dependencies. The way Solid works is that each nested computation is owned by it's parent reactive scope. In so all computations must be created as part of a root. This detail is generally taken care of for you as the `render` method contains a `createRoot` call. But it can be called directly for cases where you need to control disposal outside of this cycle.

Once inside a scope whenever the scope is re-evaluated or disposed of itself, all children computations will be disposed. In addition you can register a `onCleanup` method that will execute as part of this disposal cycle.

_Note: Solid's graph is synchronously executed so any starting point that isn't caused by a reactive update (perhaps an asynchronous entry) should start from its own root. There are other ways to handle asynchronicity as shown in the [Suspense Docs](./suspense.md)_

## Composition

Solid's primitives combine wonderfully. They encourage composing more sophisticated patterns to fit developer need.

```js
// Solid's fine-grained exivalent to React's `useReducer` Hook
const useReducer = (reducer, state) => {
  const [store, setStore] = createState(state);
  const dispatch = (action) => {
    state = reducer(state, action);
    setStore(reconcile(state));
  }
  return [store, dispatch];
};
```