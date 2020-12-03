# Hyper DOM Expressions

[![Build Status](https://img.shields.io/travis/com/ryansolid/dom-expressions.svg?style=flat)](https://travis-ci.com/ryansolid/dom-expressions)
[![NPM Version](https://img.shields.io/npm/v/hyper-dom-expressions.svg?style=flat)](https://www.npmjs.com/package/hyper-dom-expressions)
![](https://img.shields.io/bundlephobia/minzip/hyper-dom-expressions.svg?style=flat)
![](https://img.shields.io/npm/dt/hyper-dom-expressions.svg?style=flat)

This package is a Runtime API built for [DOM Expressions](https://github.com/ryansolid/dom-expressions) to provide HyperScript DSL for reactive libraries that do fine grained change detection. While the JSX plugin [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/dom-expressions/blob/master/packages/babel-plugin-jsx-dom-expressions) is more optimized with precompilation, smaller size, and cleaner syntax, this HyperScript solution has the flexibility of not being precompiled. However, Tagged Template Literals are likely a better choice in terms of performance in non-compiled environments [Lit DOM Expressions](https://github.com/ryansolid/dom-expressions/blob/master/packages/lit-dom-expressions).

## Compatible Libraries
* [Solid](https://github.com/ryansolid/solid): A declarative JavaScript library for building user interfaces.
* [ko-jsx](https://github.com/ryansolid/ko-jsx): Knockout JS with JSX rendering.
* [mobx-jsx](https://github.com/ryansolid/mobx-jsx): Ever wondered how much more performant MobX is without React? A lot.

## Getting Started

Install alongside the DOM Expressions and the fine grained library of your choice. For example with S.js:

```sh
> npm install s-js dom-expressions hyper-dom-expressions
```
Create your configuration and run dom-expressions command to generate runtime.js. More info [here](https://github.com/ryansolid/dom-expressions).

Use it to initialize your Hyper function
```js
import { createHyperScript } from 'hyper-dom-expressions';
import * as r from './runtime';

const h = createHyperScript(r);
```

Profit:
```js
const view = h('table.table.table-hover.table-striped.test-data',
  h('tbody', mapSample(() => state.data, row =>
    h('tr', [
      h('td.col-md-1', row.id),
      h('td.col-md-4', h('a', {onClick: [select, row.id]}, () => row.label)),
      h('td.col-md-1', h('a', {onClick: [remove, row.id]}, h('span.glyphicon.glyphicon-remove'))),
      h('td.col-md-6')
    ])
  ))
));

S.root(() => r.insert(document.getElementById('main'), view());)
```

Libraries may expose access to h in different ways. For example Solid has it's own entry point 'solid-js/h'.

## Differences from JSX

There are also several small differences but generally follows HyperScript conventions. All attributes are props (so use className) and to indicate attributes wrap in 'attrs' object. Ref work by passing a function. Keep in mind you need to wrap expressions in functions if you want them to be observed. For attributes since wrapping in a function is the only indicator of reactivity, passing a non-event function as a value requires wrapping it in a function.

Fragments are just arrays. Components are handled by passing a Function to the first argument of the h function. Ie:
```jsx
const view = <>
  <Component prop={value} />
  {( someValue() )}
</>

// is equivalent to:
const view = [
  h(Component, {prop: value}),
  () => someValue()
]
```

## Status

I'm still working out API details and performance profiling.