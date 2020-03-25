# JSX Rendering

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:

- Template DOM elements which are cloned on each instantiation
- A series of reference declarations using only firstChild and nextSibling
- Fine grained computations to update the created elements.

This approach both is more performant and produces less code then creating each element one by one with document.createElement.

More documentation is available at: [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/dom-expressions/tree/master/packages/babel-plugin-jsx-dom-expressions)

### Note on attribute binding order

Static attributes are created as part of the html template together. Expressions fixed and dynamic are applied afterwards in JSX binding order. While this is fine for most DOM elements there are some like input elements with `type='range'` where order matters. Keep this in mind when binding elements.

### Note on forms

Solid expects the UI to reflect its state. This means updating state on form actions. Failing to do so can cause unexpected behavior as setting state to the same value will not trigger an update even if the DOM value has diverged. In general it is recommended you handle forms in this "controlled" manner.

In some cases it might make sense to manage the form state outside of Solid via refs. These "uncontrolled" forms can also work. Just be conscious of the difference as mixing approaches can lead to unexpected results.

## Entry

The easiest way to mount Solid is to import render from 'solid-js/dom'. `render` takes a function as the first argument and the mounting container for the second and returns a disposal method. This `render` automatically creates the reactive root and handles rendering into the mount container. Solid assumes full control of the mount container so use an element with no children.

```jsx
import { render } from "solid-js/dom";

render(() => <App />, document.getElementById("main"));
```

## Events

`on_____` handlers are event handlers expecting a function. The compiler will delegate events where possible (Events that can be composed and bubble) else it will fall back to Level 1 spec "on**\_**" events.

If you wish to bind a value to your delegated event pass an array handler instead and the second argument will be passed to your event handler as the first argument (the event will be second). This can improve performance in large lists.

```jsx
function handler(itemId, e) {/*...*/}

<ul>
  <For each={state.list}>{item => <li onClick={[handler, item.id]} />}</For>
</ul>
```

This delegation solution works with Web Components and the Shadow DOM as well if the events are composed. That limits the list to custom events and most UA UI events like onClick, onKeyUp, onKeyDown, onDblClick, onInput, onMouseDown, onMouseUp, etc..

To allow for casing to work all custom events should follow the all lowercase convention of native events. If you want to use different event convention (or use Level 3 Events "addEventListener") use the "on" or "onCapture" binding.

```jsx
<div on={{ "Weird-Event": e => alert(e.detail) }} />
```

## Control Flow

While you could use a map function for loops they aren't optimized. While perhaps not as big of a deal in the VDOM since Solid is designed to not execute all the code from top down repeatedly we rely on techniques like isolated contexts and memoization. This is complicated and requires special methods.

```jsx
<ul>
  <For each={state.users} fallback={<div>No Users</div>}>
    {user => (
      <li>
        <div>{user.firstName}</div>
        <Show when={user.stars > 100}>
          <div>Verified</div>
        </Show>
      </li>
    )}
  </For>
</ul>
```

Control flows can be imported from `solid-js/dom` but as a convenience the compiler will automatically import them.

### For

```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item}</div>}
</For>
```

### Show

```jsx
<Show when={state.count > 0} fallback={<div>Loading...</div>}>
  <div>My Content</div>
</Show>
```

### Switch/Match

```jsx
<Switch fallback={<div>Not Found</div>}>
  <Match when={state.route === "home"}>
    <Home />
  </Match>
  <Match when={state.route === "settings"}>
    <Settings />
  </Match>
</Switch>
```

### Portal

```jsx
<Portal mount={document.getElementById("modal")}>
  <div>My Content</div>
</Portal>
```

### Suspense

```jsx
<Suspense fallback={<div>Loading...</div>}>
  <AsyncComponent />
</Suspense>
```

### SuspenseList

```jsx
<SuspenseList revealOrder="forwards" tail="collapsed">
  <ProfileDetails user={resource.user} />
  <Suspense fallback={<h2>Loading posts...</h2>}>
    <ProfileTimeline posts={resource.posts} />
  </Suspense>
  <Suspense fallback={<h2>Loading fun facts...</h2>}>
    <ProfileTrivia trivia={resource.trivia} />
  </Suspense>
</SuspenseList>
```

_Note these are designed to handle more complex scenarios like Component insertions. Child expressions are inert unless you return a function. For simple dynamic expressions use boolean or ternary operator._

## Refs

Refs come in 2 flavours. `ref` which directly assigns the value, and `forwardRef` which calls a callback `(ref) => void` with the reference. To support forwarded properties on spreads, both `ref` and `forwardRef` are called as functions.

### `ref`

```jsx
function MyComp() {
  let myDiv;
  setTimeout(() => console.log(myDiv.clientWidth));
  return <div ref={myDiv} />;
}
```

On a native intrinsic element as the element executes the provided variable will be assigned. This form usually is used in combination with `setTimeout` (same timing as React's `useEffect`) or `afterEffects`(same timing as React's `useLayoutEffect`) to do work after the component has mounted. Like do a DOM measurement or attach DOM plugins etc...

When applied to a Component it acts similarly but also passes a prop in that is a function that is expected to be called with a ref to forward the ref (more on this in the next section):

```jsx
function App() {
  let myDiv;
  setTimeout(() => console.log(myDiv.clientWidth));
  return <MyComp ref={myDiv} />;
}
```

### `forwardRef`

This form expects a function like React's callback refs. Original use case is like described above:

```jsx
function MyComp(props) {
  return <div forwardRef={props.ref} />;
}

function App() {
  let myDiv;
  setTimeout(() => console.log(myDiv.clientWidth));
  return <MyComp ref={myDiv} />;
}
```

You can also apply `forwardRef` on a Component:

```jsx
function App() {
  return <MyComp forwardRef={ref => console.log(ref.clientWidth)} />;
}
```

This just passes the function through as `props.ref` again and work similar to the example above except it would run synchronously during render. You can use this to chain as many `forwardRef` up a Component chain as you wish.

## Server Side Rendering (Experimental)

See [solid-ssr](https://github.com/ryansolid/solid/blob/master/packages/solid-ssr)
