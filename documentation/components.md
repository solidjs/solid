# Components

Components in Solid are just Pascal(Capital) cased functions. Their first argument is an props object and return real DOM nodes.

```jsx
const Parent = () => (
  <section>
    <Label greeting="Hello">
      <div>John</div>
    </Label>
  </section>
);

const Label = ({ greeting, children }) => (
  <>
    <div>{greeting}</div>
    {children}
  </>
);
```

Since all nodes from JSX are actual DOM nodes the only responsibility of top level Templates/Components is appending to the DOM.

Components also support dynamic bindings which allow you to pass values that will change. However you need to be careful to access your props inside bindings or effects if you want them to track change.

```jsx
// Name will never update as it is destructured outside
const StaticComponent = ({ name }) => <div>{ name }</div>

// Updates like you'd expect
const DynamicComponent = props => <div>{ props.name }</div>

// Update on state.name change
<DynamicComponent name={ state.name }/>

// will not update on name change and pass by value
const { name } = state;
<DynamicComponent name={ name }/>

// Still won't update even with the dynamic binding
<StaticComponent name={ state.name }/>
```

## Children

Solid handles JSX Children similar to React. A single child is a single value on `props.children` and multiple is an array. Normally you pass them through to the JSX view. However if you want to interact with the suggested method is the `children` helper which resolves any downstream control flows and returns a memo.

```jsx
// single child
const Label = (props) => <div class="label">Hi, { props.children }</div>

<Label><span>Josie</span></Label>

// multi child
const List = (props) => <div>{props.children}</div>;

<List>
  <div>First</div>
  {state.expression}
  <Label>Judith</Label>
</List>

// map children
const List = (props) => <ul>
  <For each={props.children}>{item => <li>{item}</li>}</For>
</ul>;

// modify and map children using helper
const List = (props) => {
  const memo = children(() => props.children);
  createEffect(() => {
    const children = memo();
    children.forEach((c) => c.classList.add("list-child"))
  })
  return <ul>
    <For each={memo()}>{item => <li>{item}</li>}</For>
  </ul>;
```

**Important:** Solid treats child tags as expensive expressions and wraps them the same way as dynamic reactive expressions. This means they evaluate lazily on `prop` access. Be careful accessing them multiple times or destructuring before the place you would use them in the view. This is because Solid doesn't have luxury of creating Virtual DOM nodes ahead of time then diffing them so resolution of these `props` must be lazy and deliberate. Use `children` helper if you wish to do this as it memoizes them.

## Props

Solid's Components are the key part of its performance. Solid's approach is "Vanishing" Components made possible by lazy prop evaluation. Instead of evaluating prop expressions immediately and passing in values, execution is deferred until the prop is accessed in the child. In so we defer execution until the last moment typically right in the DOM bindings maximizing performance. This flattens the hierarchy and removes the need to maintain a tree of Components.

```jsx
<Component prop1="static" prop2={state.dynamic} />

// compiles roughly to:

// we untrack the component body to isolate it and prevent costly updates
untrack(() => Component({
  prop1: "static",
  // dynamic expression so we wrap in a getter
  get prop2() { return state.dynamic }
}))
```

To help maintain reactivity Solid has a couple prop helpers:

```jsx
// default props
props = mergeProps({ name: "Smith" }, props);

// clone props
const newProps = mergeProps(props);

// merge props
props = mergeProps(props, otherProps);

// split props into multiple props objects
const [local, others] = splitProps(props, ["className"])
<div {...others} className={cx(local.className, theme.component)} />
```

## Lifecycle

All lifecycles in Solid are tied to the lifecycle of the reactive system.

If you wish to perform some side effect on mount or after update use `createEffect` after render has complete:

```jsx
import { createSignal, createEffect } from 'solid-js';

function Example() {
  const [count, setCount] = createSignal(0);

  createEffect(() => {
    document.title = `You clicked ${count()} times`;
  });

  return (
    <div>
      <p>You clicked {count()} times</p>
      <button onClick={() => setCount(count() + 1)}>
        Click me
      </button>
    </div>
  );
}
```

For convenience if you need to only run it once you can use `onMount` which is the same as `createEffect` but will only run once. Keep in mind Solid's cleanup is independent of this mechanism. So if you aren't reading the DOM you don't need to use these.

If you wish to release something on the Component being destroyed, simply wrap in an `onCleanup`.

```jsx
const Ticker = () => {
  const [state, setState] = createState({ count: 0 }),
    t = setInterval(() => setState({ count: state.count + 1 }), 1000);

  // remove interval when Component destroyed:
  onCleanup(() => clearInterval(t));

  return <div>{state.count}</div>
}
```

## Web Components

Since change management is independent of code modularization, Solid Templates are sufficient as is to act as Components, or Solid fits easily into other Component structures like Web Components.

[Solid Element](https://github.com/ryansolid/solid/tree/master/packages/solid-element) Provides an out of the box solution for wrapping your Solid Components as Custom Elements.
