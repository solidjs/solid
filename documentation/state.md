# State

State is the core work horse of Solid. It represents the local data, the output all the asynchronous interaction as a simple to read javascript object. While fine grained observable itself it is has a minimal API footprint and in most cases be treated like a normal object when reading, supporting destructuring and native methods. However you are dealing with proxy objects that automatically tracked as dependencies of memoization and effects and upon changing will force evaluation.

While this state concept is heavily borrowed from React and it's API from ImmutableJS, there is a key difference in the role it plays here. In React you keep things simple in your state and the whole library is about reconciling DOM rendering. Here you can almost view the State object as the target, the thing that is diffed and maintained. The DOM rendering is actually quite simple to the point the compiled source exposes the vast majority of the DOM manipulations, where you can easily drop a breakpoint. So change detection being nested and focusing on interaction with other change mechanisms are key.

### useState(object)

Initializes with object value and returns an array where the first index is the state object and the second is the setState method.

### setState(changes)
### setState(...path, changes)
### setState([...path, changes], [...path, changes])

This merges the changes into the path on the state object. All changes in set operation are applied at the same time so it is often more optimal than replace.

Alternatively if you can do multiple sets in a single call by passing an array of paths and changes.

Path can be string keys, array of keys, wildcards ('*'), iterating objects ({from, to, by}), or filter functions. This gives incredible expressive power to describe state changes.

