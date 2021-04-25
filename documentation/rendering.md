# Rendering

Solid supports templating in 3 forms JSX, Tagged Template Literals, and Solid's HyperScript variant. Although JSX is the predominate form. Why? JSX is a great DSL made for compilation. It has clear syntax, supports TypeScript, works with Babel, supports other tooling like Code Syntax Highlighting and Prettier. It was only pragmatic to use a tool that basically gives you that all for free. As a compiled solution it provides great DX. Why struggle with custom Syntax DSLs when you can use one so widely supported?

Still there is some confusion as to what JSX is and is not. JSX is an XML-like syntax extension to EcmaScript (https://facebook.github.io/jsx/). It is not a language or runtime. Those can be refered to as HyperScript. So while Solid's JSX and might resemble React it by no means works like React and there should be no illusions that a JSX library will just work with Solid. Afterall, there are no JSX libraries, as they all work without JSX, only HyperScript ones.

## JSX Compilation

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:

- Template DOM elements which are cloned on each instantiation
- A series of reference declarations using only firstChild and nextSibling
- Fine grained computations to update the created elements.

This approach both is more performant and produces less code then creating each element one by one with document.createElement.

More documentation is available at: [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/dom-expressions/tree/main/packages/babel-plugin-jsx-dom-expressions)

## Attributes and Props

Solid attempts to reflect HTML conventions as much as possible including case insensitivity of attributes.

The majority of all attributes on native element JSX are set as DOM attributes. Static values are built right into the template that is cloned. There a number of exceptions like `class`, `style`, `value`, `innerHTML` which provide extra functionality.

However, custom elements (with exception of native built-ins) default to properties when dynamic. This is to handle more complex data types. It does this conversion by camel casing standard snake case attribute names `some-attr` to `someAttr`.

However, it is possible to control this behavior directly with namespace directives. You can force an attribute with `attr:` or force prop `prop:`

```jsx
<my-element prop:UniqACC={state.value} attr:title={state.title} />
```
> Support for namespace in JSX is coming in TS 4.2.

### Note on binding order

Static attributes are created as part of the html template together. Expressions fixed and dynamic are applied afterwards in JSX binding order. While this is fine for most DOM elements there are some like input elements with `type='range'` where order matters. Keep this in mind when binding elements.

### Note on forms

Solid expects the UI to reflect its state. This means updating state on form actions. Failing to do so can cause unexpected behavior as setting state to the same value will not trigger an update even if the DOM value has diverged. In general it is recommended you handle forms in this "controlled" manner.

In some cases it might make sense to manage the form state outside of Solid via refs. These "uncontrolled" forms can also work. Just be conscious of the difference as mixing approaches can lead to unexpected results.

## Entry

The easiest way to mount Solid is to import render from 'solid-js/web'. `render` takes a function as the first argument and the mounting container for the second and returns a disposal method. This `render` automatically creates the reactive root and handles rendering into the mount container. For best performance use an element with no children.

```jsx
import { render } from "solid-js/web";

render(() => <App />, document.getElementById("main"));
```

## Events

`on_____` handlers are event handlers expecting a function. The compiler will delegate events where possible (Events that can be composed and bubble) else it will fall back `el.addEventListener`.

If you wish to bind a value to events pass an array handler instead and the second argument will be passed to your event handler as the first argument (the event will be second). This can improve performance in large lists when the event is delegated.

```jsx
function handler(itemId, e) {/*...*/}

<ul>
  <For each={state.list}>{item => <li onClick={[handler, item.id]} />}</For>
</ul>
```

This delegation solution works with Web Components and the Shadow DOM as well if the events are composed. That limits the list to custom events and most UA UI events like onClick, onKeyUp, onKeyDown, onDblClick, onInput, onMouseDown, onMouseUp, etc..

To allow for casing to work all custom events should follow the all lowercase convention of native events. If you want to use different event convention (or use Level 3 Events "addEventListener") use the "on" or "oncapture" namespace binding.

```jsx
<div on:Weird-Event={e => alert(e.detail)} />
```

## Spreads

Solid supports spread operator on native elements and Components. While not able to be optimized by the compiler these are useful for forwarding data through. Especially when the intermediary is unsure of what possible props are being passed down.

```js
function MyDiv(props) {
  return <div {...props} />
}
```

Solid supports dynamically changing which values are on the spread object value on native elements. However, currently there is a limitation on Components that while they support dynamic changes, all properties must be on the props object at first render.

## Control Flow

While you could use a map function to loop, they aren't optimized. It is perhaps not as big of a deal in VDOM-based libraries (like React), since they always execute all the code from top down repeatedly anyway. But Solid is designed to _avoid_ doing that, so we rely on techniques like isolated contexts and memoization. This is complicated and require special methods which Solid exposes through JSX control flow syntax.

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

Control flows can be imported from `solid-js` but as a convenience the compiler will automatically import them from `solid-js/web`.

### For

Keyed list iteration:
```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item}</div>}
</For>
```

Optional second argument is an index signal:
```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {(item, index) => <div>#{index()} {item}</div>}
</For>
```

### Show

Conditionally control content (make sure `when` is boolean):
```jsx
<Show when={state.count > 0} fallback={<div>Loading...</div>}>
  <div>My Content</div>
</Show>
```

Or as a way of keying blocks:
```jsx
<Show when={state.user} fallback={<div>Loading...</div>}>
  {user => <div>{user.firstName}</div>}
</Show>
```

_Note Show is designed to handle more complex scenarios like Component insertions. For simple dynamic expressions use boolean or ternary operator._

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

### ErrorBoundary

Catches uncaught errors and renders fallback content.
```jsx
<ErrorBoundary fallback={<div>Something went terribly wrong</div>}>
  <MyComp />
</ErrorBoundary>
```

### Index

Non-Keyed list iteration (rows keyed to index). This useful when there is no conceptual key, like if the data is primitives and it is the index that is fixed rather than the value. Useful nested reactivity when the data is simple strings/numbers and not models.

The item is a signal:
```jsx
<Index each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item()}</div>}
</Index>
```

Optional second argument is an index number:
```jsx
<Index each={state.list} fallback={<div>Loading...</div>}>
  {(item, index) => <div>#{index} {item()}</div>}
</Index>
```

Also available from `solid-js/web`:

### Dynamic

This component lets you insert an arbitrary Component or tag and passes the props through to it.

```jsx
<Dynamic component={state.component} someProp={state.something} />
```

### Portal

This inserts the element in the mount node. Useful for inserting Modals outside of the page layout. Events still propagate through the Component Hierarchy.

```jsx
<Portal mount={document.getElementById("modal")}>
  <div>My Content</div>
</Portal>
```

## Refs

Refs come in 2 flavours. `ref` which directly assigns the value, and which calls a callback `(ref) => void` with the reference.

### `ref`

```jsx
function MyComp() {
  let myDiv;
  createEffect(() => console.log(myDiv.clientWidth));
  return <div ref={myDiv} />;
}
```

On a native intrinsic element as the element executes the provided variable will be assigned. This form usually is used in combination with `createEffect` to do work after the component has mounted. Like do a DOM measurement or attach DOM plugins etc...

When applied to a Component it acts similarly but also passes a prop in that is a function that is expected to be called with a ref to forward the ref (more on this in the next section):

```jsx
function App() {
  let myDiv;
  createEffect(() => console.log(myDiv.clientWidth));
  return <MyComp ref={myDiv} />;
}
```

Callback form expects a function like React's callback refs. Original use case is like described above:

```jsx
function MyComp(props) {
  return <div ref={props.ref} />;
}

function App() {
  let myDiv;
  createEffect(() => console.log(myDiv.clientWidth));
  return <MyComp ref={myDiv} />;
}
```

You can also apply a callback `ref` on a Component:

```jsx
function App() {
  return <MyComp ref={ref => console.log(ref.clientWidth)} />;
}
```

This just passes the function through as `props.ref` again and work similar to the example above except it would run synchronously during render. You can use this to chain as many `ref` up a Component chain as you wish.

## Actions

> Support for Namespaced JSX Attributes is available in TypeScript 4.2

Creating a Component is the cleanest way to package reusable functionality data and view behavior. Reactive primitive composition is often the best way to reuse data behavior. However sometimes there is a need for behavior that can be re-used cross DOM element.

Solid provides a custom directive syntax for adding additional behavior to native elements as a syntax sugar over `ref` making it easy to combine multiple on a single element.

```jsx
<div use:draggable use:pannable />

const [name, setName] = createSignal("");
<input type="text" use:model={[name, setName]} />
```

To create a directive simply expose a function with this signature `(el: HTMLElement, valueAccessor: () => /*binding value*/) => {}`. Value accessor lets you track it if you wish to. And you can register `onCleanup` methods to cleanup any side effects you create.

```jsx
function model(el, value) {
  const [field, setField] = value();
  createRenderEffect(() => el.value = field());
  el.addEventListener("input", e => setField(e.target.value));
}
```

To register with TypeScript extend the JSX namespace.
```ts
declare module "solid-js" {
  namespace JSX {
    interface Actions {
      draggable: boolean;
      model: [() => any, (v: any) => any];
    }
  }
}
```

## Server Side Rendering (Experimental)

See [solid-ssr](https://github.com/solidui/solid/blob/main/packages/solid-ssr)
