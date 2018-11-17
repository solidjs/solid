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

on_____ properties get added (addEventListener) as event handlers on the element. If the event handler has 3 arguments, the second argument will be the model property or (nearest parent's). The 3rd will be a similarly attributed action property to different events of the same type (like 2 types of clicks). This is useful to automatically handle event delegation without any special syntax, methods, or synthetics.

## Operators

Most operators are general purpose. However there a couple included in this library to handle the common case of selection/multi-selection. These are often present through selection, hover effects etc.. The following operators optimize large lists down to one computation instead of n. They use the model property to identify context. And only execute their handler method on contexts that are entering or exiting selected state.

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