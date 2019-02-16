# State

State is the core work horse of Solid. It represents the local data, the output all the asynchronous interaction as a simple to read javascript object. While fine grained observable itself it is has a minimal API footprint and in most cases be treated like a normal object when reading, supporting destructuring and native methods. However you are dealing with proxy objects that automatically tracked as dependencies of memoization and effects and upon changing will force evaluation.

While this state concept is heavily borrowed from React and it's API from ImmutableJS, there is a key difference in the role it plays here. In React you keep things simple in your state and the whole library is about reconciling DOM rendering. Here you can almost view the State object as the target, the thing that is diffed and maintained. The DOM rendering is actually quite simple to the point the compiled source exposes the vast majority of the DOM manipulations, where you can easily drop a breakpoint. So change detection being nested and focusing on interaction with other change mechanisms are key.

### createState(object)

Initializes with object value and returns an array where the first index is the state object and the second is the setState method.

### setState(changes)
### setState(...path, changes)
### setState([...path, changes], [...path, changes])

This merges the changes into the path on the state object. All changes in set operation are applied at the same time so it is often more optimal than replace.

Alternatively if you can do multiple sets in a single call by passing an array of paths and changes.

Path can be string keys, array of keys, wildcards ('*'), iterating objects ({from, to, by}), or filter functions. This gives incredible expressive power to describe state changes.

All changes made in a single setState command are applied syncronously (ie all changes see each other at the same time).

### reconcile(...path, value)

This can be used to do deep diffs by applying the changes from a new State value. This is useful when pulling in immutable data trees from stores to ensure the least amount of mutations to your state. It can also be used to replace the all keys on the base state object if no path is provided as it does both positive and negative diff.

```js
setState(reconcile('users', store.get('users')))
```

If you pass as array you can configure the diff algorithm with an options object:

```js
setState(reconcile(
  ['users', store.get('users')],
  {
    key: '_id' // does a keyed comparison on arrays with key - default: 'id'
    merge: false //  overwrites rather than detects array position changes when not keyed - default: false
  }
))
```
