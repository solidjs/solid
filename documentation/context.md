# Context

Solid has Context API for dependency injection which comprises of createContext, Provide control flow, and useContext. createContext lets you define the initialization of any sort of state container. Both createProvider and useContext take that Context to initialize and make use . The value attribute for provider is passed as argument to the context initializer, or if no initializer is the value of the context.

Example below using Solid's own state mechanism although context can house just about anything.

```jsx
// counter.js
import { createState, createContext } from 'solid-js';

export createContext((count = 0) => {
  const [state, setState] = createState({ count });
  return [state, {
    increment() { setState('count', c => c + 1); }
    decrement() { setState('count', c => c - 1); }
  }];
});

// app.js
import CounterContext from './counter';

const AppComponent = () => {
  // start counter at 2
  <CounterContext.Provide value={2}>
    //...
  </CounterContext.Provide>
}

// nested.js
import { useContext } from 'solid-js';
import CounterContext from './counter';

const NestedComponent = () => {
  const [counter, { increment, decrement }] = useContext(CounterContext);
  return <div>
    <div>{( counter.count )}</div>
    <button onclick={ increment }>+</button>
    <button onclick={ decrement }>-</button>
  </div>;
}
```
