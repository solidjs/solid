# React Solid State

[![Build Status](https://img.shields.io/travis/com/ryansolid/react-solid-state.svg?style=flat)](https://travis-ci.com/ryansolid/react-solid-state)
[![Coverage Status](https://img.shields.io/coveralls/github/ryansolid/react-solid-state.svg?style=flat)](https://coveralls.io/github/ryansolid/react-solid-state?branch=master)
[![NPM Version](https://img.shields.io/npm/v/react-solid-state.svg?style=flat)](https://www.npmjs.com/package/react-solid-state)
![](https://img.shields.io/david/ryansolid/react-solid-state.svg?style=flat)

This is a local state swap for React using [Solid.js](https://github.com/ryansolid/solid). Instead of worry about when your components should update you can use declarative data. This makes use of the new React Hooks API. However it differs in a few really key ways:
- Dependencies are automatically tracked. While there is an option to set explicit dependencies it is isn't necessary.
- Nested hooks are allowed. Effects that produce sub nested effects are fair game.

The goal here is to give as close as possible to Solid's easy state management and fine grained dependency detection while still being able to use React. All of Solid's API methods have been ported. Note: this uses Hooks so it only works with Function Components which is consistent with how Components work in Solid.

There are a few differences in the API from some same named Hooks from React. Solid State are objects much like traditional React State. There is a useCleanup method that lets you register release code at both the component unmount level and in each Hook. useEffect doesn't expect a cleanup/dispose method returned for that reason. useMemo (and useSignal) return getters rather than the the pure value. This is because the context under data is accessed is the key to automatic dependency tracking. For all the information of how Solid works look at the [Documentation](https://github.com/ryansolid/solid).

To get started simply wrap your components withSolid HOC and have your Component return a Function with your JSX. From there use your hooks.

```jsx
import { withSolid, useState } from 'react-solid-state'
import React from 'react'

const WelcomeComponent = withSolid(props => {
  const [state, setState] = useState({ recipient: 'John' });
  return () => (<div onClick={() => setState({ recipient: 'Jake' })}>
    Hello { state.recipient }
  </div>);
})
```
Alternatively you can use the useObserver Hook instead:

```jsx
import { useObserver, useState, useEffect, useCleanup } from 'react-solid-state'
import React from 'react'

const CounterComponent = props => {
  const [state, setState] = useState({ count: 0 });
  useEffect(() => {
    const timer = setInterval(() => setState('count', c => c + 1), 1000);
    useCleanup(() => clearInterval(timer));
  })
  return useObserver(() => <div>{state.count}</div>);
})
```
