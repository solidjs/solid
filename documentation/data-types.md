# Data Types

Solid.js consists of a few data types. Most aren't needed to be used explicitly in applications but they are key to the underworkings of the library.

## State / Immutable State

This is the most important data type. It has a simple interface.

### constructor(object)

Initializes with object value.

### set(...path, changes)

This merges the changes into the path on the state object. All changes in set operation are applied at the same time so it is often more optimal than replace.

Alternatively if you can do multiple sets in a single call by passing an array of paths and changes.

### replace(...path, value)

This replaces the value at the path on the state object. Sometimes changes need to be made in several locations and this is the easiest way to swap out a specific value. When there is no path it will replace the current state object and notify via diff. This is useful when replacing the state object from the outside like integrating with Time Travel or Redux Dev Tools.

Alternatively if you can do multiple replaces in a single call by passing an array of paths and values.

### select(...(object|fn))

This takes either Observable, Selector, Function or an object that maps keys to an Observable, Selector, or Function. The Object is the most common form but supports the straight fn to be able to map multiple values from a single selector.

### peek(property)

This grabs a wrapped version of the property without triggering the dependency detection of the getter

### on(property, fn)

Manual subscription to the state object. This returns an object with the unsubscribe method.

## Observables

This library is based off of using specialized observables that allow for automatic dependency tracking. These are the glue that hold the other pieces together, and are often present behind the scenes even if you aren't aware.

The default export of Solid is a function which is a factory for these. In general there are 3 types of Signal's you will create. These are simple observables without much functionality so access to a larger set of operators will require other libraries.

### Signal

A simple obervable with a next fn to set it's next value and a value property to grab the latest value. It is the most basic of the Observables and is created whenever most things are passed to the default function.

### Stream

These are wrappers of existing of Observables and are initiated by passing an Observable to the default function. They trigger on changes to the underlying observable and have all the characteristics of Signals.

### Selector

These are the Observables which auto track dependencies over an function execution and are created by passing a function to the default function.

All Signals have available operators available to them:

### map

This is a simple map function to translate data from one form to another. It takes a map function and returns a new Selector which returns the mapped value.

### mapS

This returns a specialized mapping Selector that is optimized for rendering. Depending on the input value, it will call the passed in mapped function differently.

* If the value is falsey like false, null, undefined, empty array it will clear the current mapped data
* If it is a non-array it will call the mapFn once with that value
* If it is an Array it will call the fn for each item, and on changes only call it for new items.

In so this method can act as both iteration, and conditionals for JSX templates.

## Sync

This computation is used to handle side effects and is the non-pure computation. It is not derived from Signal and is not subcribable. It is generally used in the renderer and in libraries that need to keep external data in sync.