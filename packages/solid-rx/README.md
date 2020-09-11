# `solid-rx`
[![Build Status](https://img.shields.io/travis/com/ryansolid/solid.svg?style=flat)](https://travis-ci.com/ryansolid/solid)
[![NPM Version](https://img.shields.io/npm/v/solid-rx.svg?style=flat)](https://www.npmjs.com/package/solid-rx)
![](https://img.shields.io/librariesio/release/npm/solid-rx)
![](https://img.shields.io/npm/dt/solid-rx.svg?style=flat)
[![Gitter](https://img.shields.io/gitter/room/solidjs-community/community)](https://gitter.im/solidjs-community/community)

Functional Reactive Extensions for Solid.js. This package contains a number of operators intended to be use with Solid's `createMemo`, `createComputed`, and `createEffect` to create reactive transformations.

Example:

```js
import { createSignal, createMemo, createEffect } from "solid-js";
import { pipe, tap, map, filter } from "solid-rx";

const doubleEven = pipe(
  tap(console.log),
  filter(t => t % 2 === 0),
  map(t => t * 2)
);

const [number, setNumber] = createSignal(0),
  result = createMemo(doubleEven(number));
// 0

createEffect(() => console.log("transformed", result()));
// transformed 0
setNumber(1);
// 1
setNumber(2);
// 2
// transformed 4
setNumber(3);
// 3
```

These can also be useful for use with control flow. For example if you wished to delegate applying a class to any row with a model property that matched the current selection (without adding the selected state to the model):

```jsx
function selectClass(selected, className) {
  return list => {
    createEffect(
      transform(
        list,
        // wrap selection in accessor function and merge since map operators are not tracked
        // find selected element
        mergeMap(list => () => list.find(el => el.model === selected())),
        // group prev value with current
        pairwise(),
        // tap value for side effect of setting `className`
        tap(([prevEl, el]) => {
          prevEl && (prevEl.className = "");
          el && (el.className = className);
        })
      )
    );
    // return the original signal
    return list;
  };
}

const ForWithSelection = props => {
  const applyClass = selectClass(() => props.selected, "active");
  return applyClass(<For each={props.each}>{props.children}</For>);
};

// in a component somewhere:
<ForWithSelection each={state.list} selected={state.selected}>
  {row => <div model={row.id}>{row.description}</div>}
</ForWithSelection>;
```

## Why?

Truthfully nothing in this package is necessary. Solid's auto dependency tracking computations do not need to take a formal functional programming approach to be expressive and succint. If anything this can make simple expressions more complicated. Compare:

```js
// functional
createEffect(transform(
  signal,
  filter(t => t % 2 === 0),
  map(t => t * 2)
  tap(console.log)
));

// imperative
createEffect(() => {
  const s = signal();
  s % 2 === 0 && console.log(s * 2);
})
```

Obviously `map` and `tap` could have been combined in the functional example, but the point still stands. The reason you look at a library like this is that sometimes more complicated problems can easier be modelled as a transformation stream, and that this approach is very composable allowing constructing patterns for code reuse.

# Documentation

## Utilities

### `from(setter => dispose) => signal`

This operator is useful to create signals from any sort of data structure. You pass in a function that provides a setter. Use the setter to set any value to pass to the signal, from various sources like events, promises, observables, timers etc...

### `pipe(...operators) => sourceSignal => outSignal`

### `transform(sourceSignal, ...operators) => outSignal`

Tbese operators are responsible for chaining together transformations. The only difference is piped if curried and used for composition, whereas transform includes the source as an argument.

### `observable(signal) => Observable`

Connects a signal to a TC39 observable. Whenever the signal is updated the change will be propagated to the observable. This observable can be used with libraries like RxJS which unlock a whole number of operators and functionality. Going the opposite direction is just passing a signal setter to the observable subscribe method.

## Operators

All operators support curried and non-curried (signal passed as first argument) forms. Curried form is what is listed here.

### `delay(timeMs: number)`

Delay value propagation by the given time in milliseconds.

### `defer({ timeoutMs: number })`

Defers propagation until CPU is idle unless optional timeout has expired.

### `map(v => any)`

Map value to another value.

### `mergeMap(v => signal | () => any)`

Project inside signal or accessor function to output signal.

### `tap(v => void)`

Does not affect value propagation. Useful for side effects or debugging.

### `pairwise()`

Combines previous value with current value as an array.

### `scan((accumulator, value) => result, seed)`

Accumulators the result of each value propagation and feeds it to the next.

### `filter(v => boolean)`

Propagate value change if condition is true.

## Observables

Signals and Observable are similar concepts that can work together but there are a few key differences. Observables are as defined by the [TC39 Proposal](https://github.com/tc39/proposal-observable). These are a standard way of representing streams, and follow a few key conventions. Mostly that they are cold, unicast, and push-based by default. What this means is that they do not do anything until subscribed to at which point they create the source, and do so for each subscription. So if you had an Observable from a DOM Event, subscribing would add an event listener for each function you pass. In so being unicast they aren't managing a list of subscribers. Finally being push you don't ask for the latest value, they tell you.

Observables track next value, errors, and completion. This is very useful for tracking discreet events over time. Signals are much simpler. They are hot and multicast in nature and while capable of pushing values over time aren't aware of it themselves. They are simple and synchronous. They don't complete, they exist or they don't exist.

Observables can work well with Signals as being a source that feeds data into them. Like State, Observables are another tool that allow more control in a specific aspect of your application. Where State is valuable for reconciling multiple Signals together into a serializable structure to keep managing Component or Store code simple, Observables are useful for transforming Async data pipelines like handling Data Communication services.
