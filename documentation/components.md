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

Components also support dynamic bindings which allow you to pass values that will change. However you need to be careful to only access your props inside bindings or effects.

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

Keep in mind while Solid allows you set what bindings update when creating generic components don't get too restrictive here. If the consumer passes in a static value the computation will not be kept (as it will never update) and there will be minimal overhead.

```jsx
const DynamicComponent = props => <div>{ props.name }</div>

// won't result in the computation being kept
<DynamicComponent name='John' />
```

## Children

Solid handles JSX Children similar to React. A single child is a single value on `props.children` and multiple is an array.

## Web Components

Since change management is independent of code modularization, Solid Templates are sufficient as is to act as Components, or Solid fits easily into other Component structures like Web Components.

```jsx
import { createState } from "solid-js";
import { render } from "solid-js/dom";

class Component extends HTMLElement {
  constructor() {
    const [state, setState] = createState({});
    const [props, __setProps] = createState({});

    Object.assign(this, { state, setState, props, __setProps });
  }

  connectedCallback() {
    !this.shadowRoot && this.attachShadow({ mode: "open" });
    this.dispose = render(this.render.bind(this), this.shadowRoot);
  }

  diconnectedCallback() {
    this.dispose && this.dispose();
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    this.__setProps({ [attr]: newVal });
  }
}

class MyComponent extends Component {
  constuctor() {
    super();
    this.setState({ greeting: "World" });
  }
  render() {
    return <div>Hello {state.greeting}</div>;
  }
}
```

[Solid Element](https://github.com/ryansolid/solid-element) Provides an out of the box solution for wrapping your Solid Components as Custom Elements.
