# Rendering

Rendering involves precompilation of JSX templates into optimized native js code. The JSX code constructs:
* Template DOM elements which are cloned on each instantiation
* A series of reference declarations using only firstChild and nextSibling
* Fine grained computations to update the created elements.

This approach both is more performant and produces less code then creating each element one by one with document.createElement.

More documentation is available at: [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions)

## Binding

By default data is simply bound to expressions. If you wish to bind it for dynamic changes add inner parenthesis to your binding. Ex {( )}

## Events

on_____ properties get added (addEventListener) as event handlers on the element. If the event handler has more than one argument, the second argument will be the model property or (nearest parent's). The 3rd will be a similarly attributed action property to different events of the same type (like 2 types of clicks). This is useful to automatically handle event delegation without any special syntax, methods, or synthetics.

## Control Flow

While you could use a map function for loops and raw ternary operators of conditionals they aren't optimized. While perhaps not as big of a deal in the VDOM since Solid is designed to not execute all the code from top down repeatedly we rely on techniques like isolated contexts and memoization. This is complicated and requires special methods. To keep things simple and optimizable the the renderer uses a special JSX tag (<$>) for control flow. Current 'each' and 'when' are supported.

```jsx
<ul>
  <$ each={ state.users }>{
    user => <li>
      <div>{( user.firstName )}</div>
      <$ when={ user.stars > 100 }>{
        () => <div>Verified</div>
      }</$>
    </li>
  }</$>
</ul>
```

The library also includes a couple afterRender hooks for this element.

### selectWhen(signal, handler)
### selectEach(signal, handler)

These trigger on the signal to indicate the selected model/s and calls the handler function with associated element, and a boolean to indicate whether the model is selected or not.

## Custom Directives

Custom Directives are supported by Solid. They aren't often necessary as Components/HOCs can carry their own capability. However it is a powerful tool to enhance the functionality of the rendering. And can be suitable for small reusable behavior and optimizations.

Custom bindings are functions that take the form
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