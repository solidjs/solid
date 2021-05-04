# State

State is a core work horse of Solid. It is composed of many on demand reactive Signals through a proxy object. It is deeply nested reactivity, and lazily creates Signals on demand.

The advantage is that it is automatically reactive and resembles data structures you may already have. It removes the classic issues with fine-grained reactivity around mapping reactive structures and serializing JSON. And as a structure itself it can be diffed allowing interaction with immutable data and snapshots.

Through the use of proxies and explicit setters it gives the control of an immutable interface and the performance of a mutable one. The setters support a variety of forms, but to get started set and update state with an object.

> Note: State objects themselves aren't reactive. Only the property access on them are. So destructuring in non-tracked scopes will not track updates. Also passing the state object directly to bindings will not track unless those bindings explicitly access properties. Finally, while nested state objects will be notified when new properties are added, top level state cannot be tracked so adding properties will not trigger updates when iterating over keys. This is the primary reason state does benefit from being created as a top level array.

## createState

Solid's state object are deeply nested reactive data trees useful for global stores, model caches, and 3rd party immutable data interopt. They have a much more powerful setter that allows to specify nested changes and use value and function forms for updates.

They can be used in Components as well and is the go to choice when data gets more complicated (nested).

```jsx
import { createState } from "solid-js";
import { render } from "solid-js/web";

const App = () => {
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

render(() => <App />, document.getElementById("app"));
```

Remember if you destructure or spread a state object outside of a computation or JSX reactivity is lost. However, unlike Vue we don't separate our `setup` from our view code so there is little concern about transforming or transfering these reactive atoms around. Just access the properties where you need them.

With Solid State and Context API you really don't need 3rd party global stores. These proxies are optimized part of the reactive system and lend to creating controlled unidirectional patterns.

## Modifiers

This library also provides a state setter modifiers which can optionally be included to provide different behavior when setting state.

### `produce(state => void)`

Solid supports a ImmerJS style mutable form with the produce modifier.

```js
const [state, setState] = createState({
  counter: 2,
  list: [
    { id: 23, title: 'Birds' }
    { id: 27, title: 'Fish' }
  ]
});

setState(produce(s => {
  s.counter = s.counter * 3;
  s.list[1].title += '!';
}));
// {
//   counter: 6,
//   list: [
//     { id: 23, title: 'Birds' }
//     { id: 27, title: 'Fish!' }
//   ]
// }
```

### `reconcile(value, options)`

`setState` on it's own does a replace(or shallow merge). This only triggers the reactivity at that point that the change occurs. But what if that data is larger and we do not know what has changed? It can be inefficient to trigger everything starting from that higher level point.

`reconcile` can be used to do deep diffs by applying the changes from a new State value. This is useful when pulling in immutable data trees from stores like Redux, Apollo(GraphQL), RxJS or any large data snapshot(maybe from the server) to ensure the least amount of mutations to your state. That instead of replacing the whole value, we should attempt to update only what has changed.

By default `reconcile` will try to use referential equality and failing that will fall back to using a key property in the data to match items in the new input value. The new input state can be any shape and `reconcile` will deeply diff it for changes.

However `reconcile` is configurable to change that key or aggressively merge every field. This pushes all change to the leaves which is non-keyed, but could be useful for certain situations.

```js
// subscribing to an observable
const unsubscribe = store.subscribe(({ todos }) => (
  setState('todos', reconcile(todos)));
);
onCleanup(() => unsubscribe());
```

The second parameter are options to configure the diff algorithm:

```js
setState('users', reconcile(
  store.get('users'),
  {
    key: '_id' // does a keyed comparison - default: 'id'
    merge: false //  overwrites rather than detects array position changes when not keyed - default: false
  }
))
```

## Mutable State

Sometimes it makes sense especially when interopting with 3rd parties or legacy systems to use mutable state. Solid provides a `createMutable` for this purpose. It allows direct mutation much like MobX's Observables and Vue's Reactive. While less than ideal for passing data to component children, these can often the most unobtrusive way to deal with an external library.

> Use with caution as it can promote difficult to reason about code, and unexpected performance cliffs. Keep in mind Vue and MobX care less about these inefficient patterns since they have a VDOM safety net. We do not. For advanced users only.

```js
const user = createMutable({
  firstName: "John",
  lastName: "Smith",
  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  },
  set fullName(value) {
    [this.firstName, this.lastName] = value.split(" ");
  }
});

user.fullName = "Jake Snake";
```

Along with getters Mutable state supports setters. Setters are automatically batched.