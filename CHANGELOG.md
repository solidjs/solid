# Changelog

## 0.4.2 - 2019-03-18
- Add fallbacks for control flow
- Add new Portal Control Flow - This allows nodes to be rendered outside of the component tree with support for satelite ShadowRoots.
- Add new Suspend Control Flow - This renders content to a isolated document and display fallback content in its place until ready. Good for nested Async Data Fetching.
- Default node placeholders to comments (improved text interpolation)
- Added events binding for irregular event names

## 0.4.0 - 2019-02-16
- Rename API to create__ to be semantically correct
- Added implicit event delegation

## 0.3.8 - 2019-01-31
- Add support for HyperScript

## 0.3.7 - 2019-01-16
- Improved data reconciler performance
- Added data reconciler options

## 0.3.4 - 2019-01-04
- Added optional comparator for signals.
- Removed redundant type checks and extra function calls.
- Changed S.js to a dependency instead of a peer dependency.

## 0.3.2 - 2018-12-30
- Separated useSignal getter/setters for clearer more consistent API

## 0.3.1 - 2018-12-29
- Remove operators from core package since are auxilliary with new API.
- Updated JSX Dom Expressions to use new control flow JSX and JSX Fragment support.

## 0.3.0 - 2018-12-25
- New setState API inspired by Falcor paths to handle ranges.
- Reduction in API to remove State object functions and change to explicit methods.
- Expose reconcile method to do deep differences against immutable data sources (previously automatically done for selectors).
- Removed 'from' operators as limited usefulness with new patterns.

## 0.2.0 - 2018-11-13
- Large simplifications to remove inconsistency around wrapping and unwrapping values. State values are always wrapped get, and fully unwrapped on set.
- Updated binding syntax. Dynamic expressions are now bound with an inner parenthesis ```{( )}```js
- Removed Immutable State object. May attempt something similar in the future but at this time it wasn't worth the effort trying to attempt both. There are better approaches to Proxy Immutable data structures.