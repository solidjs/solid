# JSX Rendering

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:
* Template DOM elements which are cloned on each instantiation
* A series of reference declarations using only firstChild and nextSibling
* Fine grained computations to update the created elements.

This approach both is more performant and produces less code then creating each element one by one with document.createElement.

More documentation is available at: [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)

### Note on TypeScript

There are a few caveats with using Solid's JSX with TypeScript. You need to add index.d.ts from [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) to your Type roots. This defines the JSX elements and attributes needed to use Solid's JSX. It also globally defines $ for Solid's control flow. As of current it is impossible to set this as an intrinsic element. There is an issue submitted: https://github.com/microsoft/TypeScript/issues/31606. Similarly TypeScript doesn't like Solid's always single JSX children. It needs to be cast to handle those cases. Similarly issues have not gained traction as it appears TypeScript TSX only fully supports React or React-look-a-likes. https://github.com/Microsoft/TypeScript/issues/30918.

## Binding

By default data is simply bound to expressions. If you wish to bind it for dynamic changes add inner parenthesis to your binding. Ex {( )}

## Events

on_____ properties get added (addEventListener) as event handlers on the element. Camel Case events will be delegated by default and the second argument will be the model property or (nearest parent's). Use all lowercase for directly bound native events.

If you need to use non-lowercase or hyphenated event names use the events binding.

## Control Flow

While you could use a map function for loops and raw ternary operators of conditionals they aren't optimized. While perhaps not as big of a deal in the VDOM since Solid is designed to not execute all the code from top down repeatedly we rely on techniques like isolated contexts and memoization. This is complicated and requires special methods. To keep things simple and optimizable the the renderer uses a special JSX tag (<$>) for control flow. Current 'each', 'when', 'switch', 'provide', 'suspend', and 'portal' are supported.

```jsx
<ul>
  <$ each={ state.users } fallback={ <div>No Users</div> }>{
    user => <li>
      <div>{( user.firstName )}</div>
      <$ when={ user.stars > 100 }>
        <div>Verified</div>
      </$>
    </li>
  }</$>
</ul>
```

The library also includes a couple afterRender directives that can be applied to the each and when control flow.

### selectWhen(signal, handler)
### selectEach(signal, handler)

These trigger on the signal to indicate the selected model/s and calls the handler function with associated element, and a boolean to indicate whether the model is selected or not. If the handler is a string instead of a function the default behavior is to toggle a class with the string name.

These directives also require setting a model on the child element in order to identify the node.

```js
const [state, setState] = createState({
  list: [ /* ... */ ],
  selected: [ /* ... */]
})

/* .... */

<$
  each={state.list}
  afterRender={selectEach(
    () => state.selected,
    (node, selected) => node.toggleClass('selected', selected)
  )}
>{ item =>
  <div model={item} onClick={select} />
}</$>
```

## Custom Directives

Custom Directives are supported by Solid. Directives are a way to encapsulate DOM manipulation like what you do with Refs without exposing them into your Component. They are reusable and applicable to any DOM element. They aren't often necessary as Components/Hooks can carry their own capability. However it is a powerful tool to enhance the functionality of binding attributes. And can be suitable for small reusable behavior and optimizations.

Custom directives are functions that take the form:
```js
const custom = (element, valueAccessor) => {
  const value = valueAccessor();
  // ... do something with the value and the element
}
```

To use a binding simply prepend it with a $:
```js
<div $custom={someConfig} />
```