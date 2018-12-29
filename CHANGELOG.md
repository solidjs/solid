# Changelog

## 0.3.1 - 2018-12-29
- Remove operators from core package since are auxilliary with new API.
- Updated JSX Dom Expressions to use new control flow JSX.

## 0.3.0 - 2018-12-25
- New setState API inspired by Falcor paths to handle ranges.
- Reduction in API to remove State object functions and change to React-like Hooks API syntax.
- Expose reconcile method to do deep differences against immutable data sources (previously automatically done for selectors).
- Removed 'from' operators as limited usefulness with new patterns.

## 0.2.0 - 2018-11-13
- Large simplifications to remove inconsistency around wrapping and unwrapping values. State values are always wrapped get, and fully unwrapped on set.
- Updated binding syntax. Dynamic expressions are now bound with an inner parenthesis ```{( )}```js
- Removed Immutable State object. May attempt something similar in the future but at this time it wasn't worth the effort trying to attempt both. There are better approaches to Proxy Immutable data structures.