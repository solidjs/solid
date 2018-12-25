# Operators

Operators in Solid are functionally composable or pipeable and constructed using currying. Operators are typically factories that return a function that takes an input function expression and return a new function expression.

```js
let transform = operator(...args);
let output = transform(input);
let value = output();
```

These output functions are then consumed by Selectors or bindings which create the dependency tracking. More concretely:

```js
import { useState, useEffect, map } from 'solid-js'

const [state, setState] = useState({name: 'Heather', count: 1});

// single expression
const upperName = map(name => name.toUpperCase())(() => state.name);

// in steps
const reverseName = map(name => name.reverse());
const reverseUpperName = reverseName(upperName);

useEffect(() =>
  setState({ upperName: upperName(), reverseUpperName: reverseUpperName() })
)
```

Solid.js only contains a very small subset of operators helpful for rendering or connecting other observable libraries. If you require more operators it's recommended to write your own or use with a more complete library like RxJS.

Utility:

### pipe(source, ...operators)
Applies operation transform on a source.

Current operators:

### compose(...operators)
This composes a sequence of operators into a single operator.

### map(value => ....)
Maps a value to a new value.

### when(value => ....)
Memoized maps a value to a new value, but returns null when value is false or null. Useful for conditionals in rendering.

### each(item => ....)
Each is a memoized array map that returns previously mapped value if input value is the same. Useful for lists in rendering.

### observable
Returns a minimal observable implementation.

Given all operators are composable and don't involve hoisting writing your own operators is trivial.  Generally it looks like this:

```js
import { useState, useEffect, pipe, map, tap } from 'solid-js';

function someOperator(...someArguments) {
  return function(input) {
    return () =>
      //...do some calculation based on input
      // return fn(input())
  }
}

// now you can use it in a pipe
let [state, setState] = useState({data: ....}),
  someArguments = ....

useEffect(pipe(
  () => state.data,
  map(i => i),
  someOperator(...someArguments)
  tap(derived => setState({ derived }))
));
```