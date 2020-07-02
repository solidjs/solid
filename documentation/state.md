# State

State is a core work horse of Solid. It is composed of many on demand reactive signals through a proxy object. The advantage is that it is automatically reactive and resembles data structures you may already have. It removes the classic issues with fine-grained reactivity around mapping reactive structures and serializing JSON. And as a structure itself it can be diffed allowing interaction with immutable data and snapshots.

Through the use of proxies and explicit setters it gives the control of an immutable interface and the performance of a mutable one. The setters support a variety of forms, but to get started set and update state with an object.

### `createState(object)`

Initializes with object value and returns an array where the first index is the state object and the second is the setState method.

### `setState(changes)`

### `setState(...path, changes)`

This merges the changes into the path on the state object. All changes made in a single setState command are applied syncronously (ie all changes see each other at the same time). Changes can take the form of function that passes previous state and returns new state or a value. Objects are always merged.

```js
const [state, setState] = createState({ firstName: 'John', lastName: 'Miller' });

setState({ firstName: 'Johnny', middleName: 'Lee' })
// ({ firstName: 'Johnny', middleName: 'Lee', lastName: 'Miller' })

setState(state => ({ preferredName: state.firstName, lastName: 'Milner' }));
// ({ firstName: 'Johnny', preferredName: 'Johnny', middleName: 'Lee', lastName: 'Milner' })
```

setState also supports nested setting where you can indicate the path to the change. When nested the state you are updating may be other non Object values. Objects are still merged but other values (including Arrays) are replaced.

```js
const [state, setState] = createState({
  counter: 2,
  list: [
    { id: 23, title: 'Birds' }
    { id: 27, title: 'Fish' }
  ]
});

setState('counter', c => c + 1);
setState('list', l => [...l, {id: 43, title: 'Marsupials'}]);
setState('list', 2, 'read', true);
// {
//   counter: 3,
//   list: [
//     { id: 23, title: 'Birds' }
//     { id: 27, title: 'Fish' }
//     { id: 43, title: 'Marsupials', read: true }
//   ]
// }
```

Path can be string keys, array of keys, iterating objects ({from, to, by}), or filter functions. This gives incredible expressive power to describe state changes.

```js
const [state, setState] = createState({
  todos: [
    { task: 'Finish work', completed: false }
    { task: 'Go grocery shopping', completed: false }
    { task: 'Make dinner', completed: false }
  ]
});

setState('todos', [0, 2], 'completed', true);
// {
//   todos: [
//     { task: 'Finish work', completed: true }
//     { task: 'Go grocery shopping', completed: false }
//     { task: 'Make dinner', completed: true }
//   ]
// }

setState('todos', { from: 0, to: 1 }, 'completed', c => !c);
// {
//   todos: [
//     { task: 'Finish work', completed: false }
//     { task: 'Go grocery shopping', completed: true }
//     { task: 'Make dinner', completed: true }
//   ]
// }

setState('todos', todo => todo.completed, 'task', t => t + '!')
// {
//   todos: [
//     { task: 'Finish work', completed: false }
//     { task: 'Go grocery shopping!', completed: true }
//     { task: 'Make dinner!', completed: true }
//   ]
// }

setState('todos', {}, todo => ({ marked: true, completed: !todo.completed }))
// {
//   todos: [
//     { task: 'Finish work', completed: true, marked: true }
//     { task: 'Go grocery shopping!', completed: false, marked: true }
//     { task: 'Make dinner!', completed: false, marked: true }
//   ]
// }
```

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
