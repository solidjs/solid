# Operators

Operators in Solid are functionally composable or pipeable and constructed using currying. Operators are typically factories that return a function that takes an input function expression and return a new function expression.

```js
let transform = operator(...args);
let output = transform(input);
let value = output();
```

These output functions are then consumed by Selectors or bindings which create the dependency tracking. More concretely:

```js
import { State, map } from 'solid-js'

state = new State({name: 'Heather', count: 1});

// single expression
upperName = map((name) => name.toUpperCase())(() => state.name)

// in steps
reverseName = map((name) => name.reverse())
reverseUpperName = reverseName(upperName)

state.select({ upperName, reverseUpperName });
```

Solid.js only contains a very small subset of operators helpful for rendering or connecting other observable libraries. If you require more operators it's recommended to write your own or use with a more complete library like RxJS.

Utility:

### pipe(source, ...operators)
Applies operation transform on a source.

### from(observable | promise, seed)
Makes promises/observables trackable by Solid.

Current operators:

### compose(...operators)
This composes a sequence of operators into a single operator.

### map(value => ....)
Maps a value to a new value.

### memo(item => ....)
A super mapper for rendering, memo is a memoized map that returns previously mapped value if input value is the same. It automatically splits across arrays and clears on falsey values.

### observable
Returns a minimal observable implementation.

Given all operators are composable and don't involve hoisting writing your own operators is trivial.  Generally it looks like this:

```js
import { State, pipe, map } from 'solid-js';

function someOperator(...someArguments) {
  return function(input) {
    return () =>
      //...do some calculation based on input
      // return fn(input())
  }
}

// now you can use it in a pipe
let state = new State({data: ....}),
  someArguments = ....

state.select({
  derived: pipe(
    () => state.data,
    map(i => i),
    someOperator(...someArguments)
  )
});
```