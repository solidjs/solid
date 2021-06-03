# Rendering

Solid supports templating in 3 forms JSX, Tagged Template Literals and Solid's HyperScript variant, although JSX is the predominate form. Why? JSX is a great DSL made for compilation. It has clear syntax, supports TypeScript, works with Babel and supports other tooling like Code Syntax Highlighting and Prettier. It was only pragmatic to use a tool that basically gives you that all for free. As a compiled solution it provides great DX. Why struggle with custom Syntax DSLs when you can use one so widely supported?

## JSX Compilation

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:

- Template DOM elements which are cloned on each instantiation
- A series of reference declarations using only firstChild and nextSibling
- Fine grained computations to update the created elements.

This approach is both more performant and produces less code than creating each element, one by one, with document.createElement.

## Attributes and Props

Solid attempts to reflect HTML conventions as much as possible including case insensitivity of attributes.

The majority of all attributes on native element JSX are set as DOM attributes. Static values are built right into the template that is cloned. There a number of exceptions like `class`, `style`, `value`, `innerHTML` which provide extra functionality.

However, custom elements (with exception of native built-ins) default to properties when dynamic. This is to handle more complex data types. It does this conversion by camel casing standard snake case attribute names `some-attr` to `someAttr`.

However, it is possible to control this behavior directly with namespace directives. You can force an attribute with `attr:` or force prop `prop:`

```jsx
<my-element prop:UniqACC={state.value} attr:title={state.title} />
```

> **Note:** Static attributes are created as part of the html template that is cloned. Expressions fixed and dynamic are applied afterwards in JSX binding order. While this is fine for most DOM elements there are some, like input elements with `type='range'`, where order matters. Keep this in mind when binding elements.

## Entry

The easiest way to mount Solid is to import render from 'solid-js/web'. `render` takes a function as the first argument and the mounting container for the second and returns a disposal method. This `render` automatically creates the reactive root and handles rendering into the mount container. For best performance use an element with no children.

```jsx
import { render } from "solid-js/web";

render(() => <App />, document.getElementById("main"));
```

> **Important** The first argument needs to be a function. Otherwise we can't properly track and schedule the reactive system. This simple ommission will cause your Effects not to run.
## Components

Components in Solid are just Pascal (Capital) cased functions. Their first argument is a props object and they return real DOM nodes.

```jsx
const Parent = () => (
  <section>
    <Label greeting="Hello">
      <div>John</div>
    </Label>
  </section>
);

const Label = props => (
  <>
    <div>{props.greeting}</div>
    {props.children}
  </>
);
```

Since all JSX nodes are actual DOM nodes, the only responsibility of top level Components is to append them to the DOM.

## Props

Much like React, Vue, Angular and other frameworks, Solid allows you to define properties on your components to pass data to child components. Here a parent is passing the string "Hello" to the `Label` component via a `greeting` property.

```jsx
const Parent = () => (
  <section>
    <Label greeting="Hello">
      <div>John</div>
    </Label>
  </section>
);
```

In the above example, the value set on `greeting` is static, but we can also set dynamic values. For example:

```jsx
const Parent = () => {
  const [greeting, setGreeting] = createSignal("Hello");

  return (
    <section>
      <Label greeting={greeting()}>
        <div>John</div>
      </Label>
    </section>
  );
};
```

Components can access properties passed to them via a `props` argument.

```jsx
const Label = props => (
  <>
    <div>{props.greeting}</div>
    {props.children}
  </>
);
```

Unlike in some other frameworks, you cannot use object destructuring on the `props` of a component. This is because the `props` object, behind the scenes, relies on Object getters to lazily retrieve values. Using object destructuring breaks the reactivity of `props`.

This example shows the "correct" way of accessing props in Solid:

```jsx
// Here, `props.name` will update like you'd expect
const MyComponent = props => <div>{props.name}</div>;
```

This example shows the wrong way of accessing props in Solid:

```jsx
// This is bad
// Here, `props.name` will not update (i.e. is not reactive) as it is destructured into `name`
const MyComponent = ({ name }) => <div>{name}</div>;
```

While the props object looks like a normal object when you use it (and Typescript users will note that it is typed like a normal object), in reality it is reactive – somewhat similar to a Signal. This has a few implications.

Because unlike most JSX frameworks, Solid's function components are only executed once (rather than every render cycle), the following example will not work as expected.

```jsx
import { createSignal } from "solid-js";

const BasicComponent = props => {
  const value = props.value || "default";

  return <div>{value}</div>;
};

export default function Form() {
  const [value, setValue] = createSignal("");

  return (
    <div>
      <BasicComponent value={value()} />
      <input type="text" oninput={e => setValue(e.currentTarget.value)} />
    </div>
  );
}
```

In this example, what we probably want to happen is for the `BasicComponent` to display the current value typed into the `input`. But, as a reminder, the `BasicComponent` function will only be executed once when the component is initially created. At this time (at creation), `props.value` will equal `''`. This means that `const value` in `BasicComponent` will resolve to `'default'` and never update. While the `props` object is reactive, accessing the props in `const value = props.value || 'default';` is outside the observable scope of Solid, so it isn't automatically re-evaluated when props change.

So how can we fix our problem?

Well, in general, we need to access `props` somewhere that Solid can observe it. Generally this means inside JSX or inside a `createMemo`, `createEffect`, or thunk(`() => ...`). Here is one solution that works as expected:

```jsx
const BasicComponent = props => {
  return <div>{props.value || "default"}</div>;
};
```

This, equivalently, can be hoisted into a function:

```jsx
const BasicComponent = props => {
  const value = () => props.value || "default";

  return <div>{value()}</div>;
};
```

Another option, if it is an expensive computation, is to use `createMemo`. For example:

```jsx
const BasicComponent = props => {
  const value = createMemo(() => props.value || "default");

  return <div>{value()}</div>;
};
```

Or using a helper

```jsx
const BasicComponent = props => {
  props = mergeProps({ value: "default" }, props);

  return <div>{props.value}</div>;
};
```

As a reminder, the following examples will _not_ work:

```jsx
// bad
const BasicComponent = props => {
  const { value: valueProp } = props;
  const value = createMemo(() => valueProp || "default");
  return <div>{value()}</div>;
};

// bad
const BasicComponent = props => {
  const valueProp = prop.value;
  const value = createMemo(() => valueProp || "default");
  return <div>{value()}</div>;
};
```

Solid's Components are the key part of its performance. Solid's approach of "Vanishing" Components is made possible by lazy prop evaluation. Instead of evaluating prop expressions immediately and passing in values, execution is deferred until the prop is accessed in the child. Doing so we postpone execution until the last moment, typically right in the DOM bindings, maximizing performance. This flattens the hierarchy and removes the need to maintain a tree of Components.

```jsx
<Component prop1="static" prop2={state.dynamic} />;

// compiles roughly to:

// we untrack the component body to isolate it and prevent costly updates
untrack(() =>
  Component({
    prop1: "static",
    // dynamic expression so we wrap in a getter
    get prop2() {
      return state.dynamic;
    }
  })
);
```

To help maintain reactivity Solid has a couple of prop helpers:

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

## Children

Solid handles JSX Children similar to React. A single child is a single value on `props.children` and multiple children is handled an array of values. Normally you pass them through to the JSX view. However, if you want to interact with them the suggested method is the `children` helper which resolves any downstream control flows and returns a memo.

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
  // children helper memoizes value and resolves all intermediate reactivity
  const memo = children(() => props.children);
  createEffect(() => {
    const children = memo();
    children.forEach((c) => c.classList.add("list-child"))
  })
  return <ul>
    <For each={memo()}>{item => <li>{item}</li>}</For>
  </ul>;
```

**Important:** Solid treats child tags as expensive expressions and wraps them the same way as dynamic reactive expressions. This means they evaluate lazily on `prop` access. Be careful accessing them multiple times or destructuring before the place you would use them in the view. This is because Solid doesn't have the luxury of creating Virtual DOM nodes ahead of time and then diffing them, so resolution of these `props` must be lazy and deliberate. Use `children` helper if you wish to do this as it memoizes them.
