# State

State is the core work horse of Solid. It represents the local data, the output all the asynchronous interaction as a simple to read javascript object. While fine grained observable itself it is has a minimal API footprint and in most cases be treated like a normal object when reading, supporting destructuring and native methods. However, when under a computation, ie under the function context of a Sync or Selector, you are dealing with proxy objects that automatically tracked as dependencies of the computation and upon changing will force evaluation. In fact, Solid can be written that dependency tracking is handled automatically by the library.

While this state concept is heavily borrowed from React and it's API from ImmutableJS, there is a key difference in the role it plays here. In React you keep things simple in your state and the whole library is about reconciling DOM rendering. Here you can almost view the State object as the target, the thing that is diffed and maintained. The DOM rendering is actually quite simple to the point the compiled source exposes the vast majority of the DOM manipulations, where you can easily drop a breakpoint. So change detection being nested and focusing on interaction with other change mechanisms are key.

### constructor(object)

Initializes with object value.

### set(...path, changes)

This merges the changes into the path on the state object. All changes in set operation are applied at the same time so it is often more optimal than replace.

Alternatively if you can do multiple sets in a single call by passing an array of paths and changes.

### replace(...path, value)

This replaces the value at the path on the state object. Sometimes changes need to be made in several locations and this is the easiest way to swap out a specific value. When there is no path it will replace the current state object and notify via diff. This is useful when replacing the state object from the outside like integrating with Time Travel or Redux Dev Tools.

Alternatively if you can do multiple replaces in a single call by passing an array of paths and values.

### select(...(object|fn))

This takes either Observable, Selector, Function or an object that maps keys to an Observable, Selector, or Function. The Object is the most common form but supports a straight function to be able to map multiple values from a single selector.
