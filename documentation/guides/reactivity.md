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

## Introducing Primitives

Solid is made up of 3 primary primitves, Signal, Memo, and Effect. At their core is the Observer pattern where Signals (and Memos) are tracked by
wrapping Memos and Effects.

Signals are the simplest primitive. They contain value, and get and set functions so we can intercept when they are read and written to.

```js
const [count, setCount] = createSignal(0);
```

Effects are functions that wrap reads of our signal and re-execute when ever a dependent Signal's value changes. This is useful for creating side effects, like rendering.

```js
createEffect(() => console.log("The latest count is", count()));
```

Finally, Memos are cached derived values. They share the properties of both Signals and Effects. They track their own dependent Signals, re-executing only when those change, and are trackable Signals themselves.

```js
const fullName = createMemo(() => `${firstName()} ${lastName()}`);
```

# How it Works

Signals are event emitters that hold a list of subscriptions. They notify their subscribers whenever their value changes.

Where things get more interesting is how these subscriptions happen. Solid uses automatic dependency tracking. Updates happen automatically as the data changes.

The trick is a global stack at runtime. Before a Effect or Memo executes (or re-executes) its developer-provided function, it pushes itself on to that stack. Then any Signal that is read checks if there is a current listener on the stack and if so adds the listener to its subscriptions.

You can think of it like this:
```js
function createSignal(value) {
  const subscribers = new Set();

  const read = () => {
    const listener = getCurrentListener();
    if (listener) subscribers.add(listener);
    return value;
  }

  const write = (nextValue) => {
    value = nextValue;
    for (const sub of subscribers) sub.run();
  }

  return [read, write];
}
```
Now whenever we update the Signal we know which Effects to re-run. Simple yet effective. The actual implementation is much more complicated but that is the guts of what is going on.

# Considerations

This approach to reactivity is very powerful and dynamic. It can handle dependencies changing on the fly through executing different branches of conditional code. It also works through many levels of indirection. Any function executed inside a tracking scope is also being tracked.

However, there are some key behaviors and tradeoffs we must be aware of.

1. All reactivity is tracked from function calls whether directly or hidden beneath getter/proxy and triggered by property access. This means where you access properties on reactive objects is important.

2. Components and callbacks from control flows are not tracking scopes and only execute once. This means destructuring or doing logic top-level in your components will not re-execute. You must access these Signals, State, and props from within other reactive primitives or the JSX for that part of the code to re-evaluate.

3. This approach only tracks synchronously. If you have a setTimeout or use an async function in your Effect the code that executes async after the fact won't be tracked.
