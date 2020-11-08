# Reactivity

Solid's data management is built off a set of flexible reactive primitives are responsible for all the updates. It takes a very similar approach to MobX or Vue except it never trades its granularity for a VDOM. Dependencies are automatically tracked when you access your reactive values in your Effects and JSX View code.

Solid has a number of reactive primitives but the main 2 are Signals, and State. Ultimately you will need to understand both to write effective Solid code.

Signals hold simple values that you view as atomic immutable cells that consist of a getter and setter. These are ideal for simple local component values. They are called signals as they act as tiny streams that wire your application together.

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

> **For React Users:** This looks like React Hooks, but it is very different. There are no Hook rules, or concern about stale closures because your Component only runs once. It is only the "Hooks" that re-execute. So they always have the latest.

Solid's state object are deeply nested reactive data trees useful for global stores, model caches, and 3rd party immutable data interopt. They have a much more powerful setter that allows to specify nested changes and use value and function forms for updates.

They can be used in Components as well and is the go to choice when data gets more complicated (nested).

```jsx
import { createState, onCleanup } from "solid-js";
import { render } from "solid-js/web";

const App = () => {
  const [state, setState] = createState({
    user: {
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${state.user.firstName} ${state.user.lastName}`;
      }
    }
  });

  return (
    <div onClick={() => setState("user", "lastName", value => value + "!")}>
      {state.user.fullName}
    </div>
  );
};

render(() => <App />, document.getElementById("app"));
```

Remember if you destructure or spread a state object reactivity is lost. However, unlike Vue we don't separate our `setup` from our view code so there is little concern about transforming or transfering these reactive atoms around. Just access the properties where you need them.

With Solid State and Context API you really don't need 3rd party global stores. These proxies are optimized part of the reactive system and lend to creating controlled unidirectional patterns.

## Signals

Signals are the glue that hold the library together. They are a simple primitive that contain values that change over time. With Signals you can track all sorts of changes from various sources in your applications. You can update a Signal manually or from any Async source.

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

This mechanism is based on the executing function's scope so Signals reads can be composed and nested as many levels as desired. By wrapping a Signal read in a thunk `() => signal()` you have effectively created a derived signal that can be tracked as well. The same holds true for accessing state. Want to use state as a signal just wrap it in a function:

```js
// I can be tracked
const firstName = () => state.user.firstName;

return <div>{firstName()}</div>;
```

These accessors are just functions that can be tracked and return a value. No additional primitive or method is needed for them to work as Signals in their own right. However, you need another primitive to create that reactive scope:

## Computations

An computation is calculation over a function execution that automatically and dynamically tracks any child signals that are accessed during that execution. A computation goes through a cycle on execution where it releases its previous execution's dependencies, then executes grabbing the current dependencies.

There are 3 main computations used by Solid: Memos which are pure and designed to cache values until their reactivity forces re-evaluation, Computeds which are designed to write to other signals, and Effects which are intended to produce side effects after rendering.

```js
import { createSignal, createEffect, createMemo } from "solid-js";

const [count, setCount] = createSignal(1),
  doubleCount = createMemo(() => count() * 2);
createEffect(() => console.log(doubleCount()));
setCount(count() + 1);

// 2
// 4
```

Effects are what allow the DOM to stay up to date. While you don't see them, everytime you write an expression in the JSX(code between the parenthesis `{}`), the compiler is wrapping it in a function and passing it to a `createEffect` call.

Memos allow us to store and access values without re-evaluating them until their dependendencies change.

Keep in mind memos are only necessary if you wish to prevent re-evaluation when the value is read. Useful for expensive operations like DOM Node creation. Any example with a memo could also just be a function and effectively be the same without caching as it's just another signal.

```js
import { createSignal, createEffect } from "solid-js";

const [count, setCount] = createSignal(1),
  doubleCount = () => count() * 2;
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

## Managing Dependencies and Updates

Sometimes we want to be explicit about what triggers computations to update and nothing else. Solid offers ways to explicitly set dependencies or to not track under a tracking scope at all.

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

Another situation is maybe you want something to run only on mount:

```js
// does not update when props update
createEffect(() => untrack(() => console.log("Mounted with", props.a, props.b)));
```

Solid executes synchronously but sometimes you want to apply multiple changes at once. `batch` allows us to do that without triggering updates multiple times.

```js
batch(() => {
  setA(4);
  setB(6);
});
```

## Cleanup

While Solid does not have Component lifecyles in the traditional sense, it still needs to handle cleaning up reactive dependencies. The way Solid works is that each nested computation is owned by it's parent reactive scope. In so all commputations must be created as part of a root. This detail is generally taken care of for you as the `render` method contains a `createRoot` call. But it can be called directly for cases where you need to control disposal outside of this cycle.

Once inside a scope whenever the scope is re-evaluated or disposed of itself, all children computations will be disposed. In addition you can register a `onCleanup` method that will execute as part of this disposal cycle.

_Note: Solid's graph is synchronously executed so any starting point that isn't caused by a reactive update (perhaps an asynchronous entry) should start from its own root. There are other ways to handle asynchronicity as shown in the [Suspense Docs](./suspense.md)_

## Composition

State and Signals combine wonderfully as wrapping a state selector in a function instantly makes it reactive accessor. They encourage composing more sophisticated patterns to fit developer need.

```js
// deep reconciled immutable reducer
const useReducer = (reducer, init) => {
  const [state, setState] = createState(init),
    [getAction, dispatch] = createSignal();
  createComputed(prevState => {
    let action, next;
    if (!(action = getAction())) return prevState;
    next = reducer(prevState, action);
    setState(reconcile(next));
    return next;
  }, init);
  return [state, dispatch];
};
```

## Operators and FRP

Solid signals can also be used as a basis for streams and work as powerful primitives to compose complicated transformations. Operators are the key to composing these behaviors. They are not computations themselves and are designed to be passed into a computation. The possibilities of operators are endless.

The `solid-rx` package contains operators that can be used with Solid.
