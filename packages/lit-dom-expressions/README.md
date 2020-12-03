# Lit DOM Expressions

[![Build Status](https://img.shields.io/travis/com/ryansolid/dom-expressions.svg?style=flat)](https://travis-ci.com/ryansolid/dom-expressions)
[![NPM Version](https://img.shields.io/npm/v/lit-dom-expressions.svg?style=flat)](https://www.npmjs.com/package/lit-dom-expressions)
![](https://img.shields.io/bundlephobia/minzip/lit-dom-expressions.svg?style=flat)
![](https://img.shields.io/npm/dt/lit-dom-expressions.svg?style=flat)

This package is a Runtime API built for [DOM Expressions](https://github.com/ryansolid/dom-expressions) to provide Tagged Template Literals DSL to DOM transformation for reactive libraries that do fine grained change detection. While the JSX plugin [Babel Plugin JSX DOM Expressions](https://github.com/ryansolid/dom-expressions/blob/master/packages/babel-plugin-jsx-dom-expressions) is more optimized with precompilation and cleaner syntax, this Tagged Template solution has minimal overhead over it.

Upon first instantiation templates are compiled into DOM templates and generated code. Each instantiation there after the template is cloned and the optimized code is ran.

## Compatible Libraries

- [Solid](https://github.com/ryansolid/solid): A declarative JavaScript library for building user interfaces.
- [ko-jsx](https://github.com/ryansolid/ko-jsx): Knockout JS with JSX rendering.
- [mobx-jsx](https://github.com/ryansolid/mobx-jsx): Ever wondered how much more performant MobX is without React? A lot.

## Getting Started

Install alongside the DOM Expressions and the fine grained library of your choice. For example with S.js:

```sh
> npm install s-js dom-expressions lit-dom-expressions
```

Create your configuration and run dom-expressions command to generate runtime.js. More info [here](https://github.com/ryansolid/dom-expressions).

Use it to initialize the html function:

```js
import { createHTML } from "lit-dom-expressions";
import * as r from "./runtime";

const html = createHTML(r);
```

Profit:

```js
const view = html`
  <table class="table table-hover table-striped test-data">
    <tbody>
      <${For} each=${() => state.data}
        >${row => html`
          <tr>
            <td class="col-md-1" textContent=${row.id} />
            <td class="col-md-4">
              <a onClick=${[select, row.id]}>${() => row.label}</a>
            </td>
            <td class="col-md-1">
              <a onClick=${[remove, row.id]}
                ><span class="glyphicon glyphicon-remove"
              /></a>
            </td>
            <td class="col-md-6" />
          </tr>
        `}<//
      >
    </tbody>
  </table>
`;
```

Libraries may expose access to html in different ways. For example Solid has it's own entry point 'solid-js/html'.

## Differences from JSX

Currently there is no support for spreads. You have to wrap dynamic expressions yourself in functions. Fragments aren't explicit and the markup can just return multiple children.

```js
const view = html`
  <div>
    <${ChildComponent} someProp=${() => state.data} />
  </div>
`;
```

And with children:

```js
const view = html`
  <${MyComponent} someProp=${value}>Child Content<//>
`;
```

Synthetic events more or less work the same as the JSX version.

## Status

I'm still working out API details and improving performance.
