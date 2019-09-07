# Context

Solid has Context API for dependency injection which comprises of createContext, Provider control flow, and useContext. createContext lets you create the Context Object.  When Solid renders a component that subscribes to this Context object it will read the current context value from the closest matching Provider above it in the tree. If there is not provider above it will use the default value.

Example below using Solid's own state mechanism although context can house just about anything.

```jsx
// counter-context.js
import { createState, createContext } from 'solid-js';

export const CounterContext = createContext([{ count: 0 }, {}]);

export function CounterProvider(props) {
  const [state, setState] = createState({ count: props.count || 0 }),
    store = [state, {
      increment() { setState('count', c => c + 1); },
      decrement() { setState('count', c => c - 1); }
    }];

  return <CounterContext.Provider value={store}>{(
    props.children
  )}</CounterContext.Provider>
}

// app.js
import { CounterProvider } from './counter-context';

const AppComponent = () => {
  // start counter at 2
  <CounterProvider count={2}>
    //...
  </CounterProvider>
}

// nested.js
import { useContext } from 'solid-js';
import { CounterContext } from './counter-context';

const NestedComponent = () => {
  const [counter, { increment, decrement }] = useContext(CounterContext);
  return <div>
    <div>{( counter.count )}</div>
    <button onclick={ increment }>+</button>
    <button onclick={ decrement }>-</button>
  </div>;
}
```
