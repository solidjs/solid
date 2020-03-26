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

Since the all nodes from JSX are actual DOM nodes the only responsibility of top level Templates/Components is appending to the DOM.

Components also support dynamic bindings which allow you to pass values that will change. However you need to be careful to access your props inside bindings or effects it you want them to track change.

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

If you are very performance oriented you can also pass accessor functions instead of using Dynamic syntax on Function components. This will reduce overhead a little bit but requires that a function is always passed.

```jsx
const DynamicComponent = ({ name }) => <div>{ name() }</div>

<DynamicComponent name={() => state.name}/>
```

## Children

Solid handles JSX Children similar to React. A single child is a single value on `props.children` and multiple is an array.

## LifeCycle

Solid's Components are the key part of its performance. Solid's approach is "Vanishing" Components made possible by lazy prop evaluation. Instead of evaluating prop expressions immediately and passing in values, execution is deferred until the prop is accessed in the child. In so we defer execution until the last moment typically right in the DOM bindings maximizing performance. This flattens the hierarchy and removes the need to maintain a tree of Components. Instead of lifecycles you can use Solid's primitives to express powerful dynamic behaviour.

## Web Components

Since change management is independent of code modularization, Solid Templates are sufficient as is to act as Components, or Solid fits easily into other Component structures like Web Components.

[Solid Element](https://github.com/ryansolid/solid/tree/master/packages/solid-element) Provides an out of the box solution for wrapping your Solid Components as Custom Elements.
