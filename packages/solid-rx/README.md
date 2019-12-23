# `solid-rx`

Functional Reactive Extensions for Solid.js. This package contains a number of operators intended to be use with Solid's `createMemo` and `createEffect` to create reactive transformations.

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

These can also be useful for use with control flow. The transform property exposes the ability to pass in an transformation operator. For example if you wished to delegate applying a class to any row with a model property that matched the current selection (without adding the selected state to the model):

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

const applyClass = selectClass(() => state.selected, "active");
return (
  <For each={state.list} transform={applyClass}>
    {row => <div model={row.id}>{row.description}</div>}
  </For>
);
```

This can be very powerful especially when combined with as a HOC(Higher Order Component):

```jsx
const ForWithSelection = props => {
  const applyClass = selectClass(() => props.selected, "active");
  return (
    <For each={props.each} transform={applyClass}>
      {props.children}
    </For>
  );
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

Obviously map and tap could have been combined in the functional example, but the point still stands. The reason you look at a library like this is that sometimes more complicated problems can easier be modelled as a transformation stream, and that this approach is very composable allowing constructing patterns for code reuse.

## Documentation

...Coming
