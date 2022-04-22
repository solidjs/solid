<p>
  <img width="100%" src="https://raw.githubusercontent.com/solidjs/solid/master/banner.png" alt="SolidJS">
</p>

[![Build Status](https://github.com/solidjs/solid/workflows/Solid%20CI/badge.svg)](https://github.com/solidjs/solid/actions/workflows/main-ci.yml)
[![Coverage Status](https://img.shields.io/coveralls/github/solidjs/solid.svg?style=for-the-badge)](https://coveralls.io/github/solidjs/solid?branch=main)
[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=social?style=for-the-badge)](https://www.reddit.com/r/solidjs/)

Solid is a declarative JavaScript library for creating user interfaces. Instead of using a Virtual DOM, it compiles its templates to real DOM nodes and updates them with fine-grained reactions. Declare your state and use it throughout your app, and when a piece of state changes, only the code that depends on it will rerun.

## Solid is:
### Performant
Solid's performance is almost indistinguishable from optimized vanilla JavaScript (See Solid on the [JS Framework Benchmark](https://rawgit.com/krausest/js-framework-benchmark/master/webdriver-ts-results/table.html)). Solid is [small](https://bundlephobia.com/package/solid-js@1.3.15) and completely tree-shakable, and [blazing-fast](https://levelup.gitconnected.com/how-we-wrote-the-fastest-javascript-ui-framework-again-db097ddd99b6) when rendering on the server. Whether you're writing a fully client-rendered SPA or a server-rendered app, your users see it faster than ever.

### Powerful
Solid is fully-featured with everything you can expect from a modern framework. Performant state management is built-in with Context and Stores: you don't have to reach for a third party library to manage global state. With Resources, you can use data loaded from the server like any other piece of state and built a responsive UI for it thanks to Suspense and Concurrent Rendering. And when you're ready to move to the server, Solid has full SSR and serverless support, with streaming and progressive hydration to get to interactive as quickly as possible. Check out our full [interactive features walkthrough](https://www.solidjs.com/tutorial/introduction_basics)!

### Pragmatic
Do more with less: use simple, composable primitives without hidden rules and gotchas. In Solid, components are just functions - rendering is determined purely by how your state is used - so you're free to organize your code how you like and you don't have to learn a new rendering system. Solid encourages patterns like declarative code and read-write segregation that help keep your project maintainable, but isn't opinionated enough to get in your way.

### Productive
Solid is built on established tools like JSX and TypeScript and integrates with the Vite ecosystem. Because Solid creates actual DOM nodes, your existing mental model of the webpage - and DOM-based libraries like D3 and Greensock - come with you. And the Solid ecosystem is growing fast, with [custom primitives](https://github.com/solidjs-community/solid-primitives), [component libraries](https://hope-ui.com/), and build-time utilities that let you [write Solid code in new ways](https://github.com/LXSMNSYC/solid-labels).

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)!


## The Gist

See it in action in our [Playground!](https://playground.solidjs.com/?hash=-894962706&version=1.3.13)

```jsx
import { render } from "solid-js/web";
import { createSignal } from "solid-js";

// A component is just a function that (optionally) accepts properties and returns a DOM node
const Counter = (props) => {
  // Create a piece of reactive state, giving us a accessor, count(), and a setter, setCount()
  const [count, setCount] = createSignal(props.startingCount || 1);

  // The increment function calls the setter
  const increment = () => setCount(count() + 1);

  console.log(
    "The body of the function runs once, like you'd expect from calling any other function, so you only ever see this console log once."
  );

  // JSX allows us to write HTML within our JavaScript function and include dynamic expressions using the { } syntax
  // The only part of this that will ever rerender is the count() text.
  return (
    <button type="button" onClick={increment}>
      Increment {count()}
    </button>
  );
};

// The render function mounts a component onto your page
render(() => <Counter startingCount={2} />, document.getElementById("app"));
```

Solid compiles our JSX down to efficient real DOM expressions and updates, still using the same reactive primitives (createSignal) at runtime. Here's what that looks like in this example:

```js

import { render, createComponent, delegateEvents, insert, template } from 'solid-js/web';
import { createSignal } from 'solid-js';

const _tmpl$ = /*#__PURE__*/template(`<button type="button">Increment </button>`, 2);

const Counter = props => {
  const [count, setCount] = createSignal(props.startingCount || 1);
  const increment = () => setCount(count() + 1);

  console.log("The body of the function runs once . . .");

  return (() => {
    //_el$ is a real DOM node!
    const _el$ = _tmpl$.cloneNode(true);
          _el$.firstChild;

    _el$.$$click = increment;

    //This inserts the count as a child of the button in a way that allows count to update without rerendering the whole button
    insert(_el$, count, null);

    return _el$;
  })();
};

render(() => createComponent(Counter, {
  startingCount: 2
}), document.getElementById("app"));

delegateEvents(["click"]);
```
## Quick Start

You can get started with a simple app by running the following in your terminal:

```sh
> npx degit solidjs/templates/js my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

Or for TypeScript:

```sh
> npx degit solidjs/templates/ts my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

This will create a minimal client-rendered application powered by [Vite](https://vitejs.dev/).

Or you can install the dependencies in your own project. To use Solid with JSX (recommended) run:

```sh
> npm install solid-js babel-preset-solid
```

The easiest way to get setup is add `babel-preset-solid` to your .babelrc, or babel config for webpack, or rollup:

```js
"presets": ["solid"]
```

For TypeScript remember to set your TSConfig to handle Solid's JSX by:

```js
"compilerOptions": {
  "jsx": "preserve",
  "jsxImportSource": "solid-js",
}
```

## Documentation

Check out the [Documentation](https://www.solidjs.com/guide) website.

[Examples](https://github.com/solidjs/solid/blob/main/documentation/resources/examples.md)

## Browser Support

The last 2 versions of modern evergreen browsers and Node LTS.

<img src="https://saucelabs.github.io/images/opensauce/powered-by-saucelabs-badge-gray.svg?sanitize=true" alt="Testing Powered By SauceLabs" width="300"/>

## Community

Come chat with us on [Discord](https://discord.com/invite/solidjs)

### Contributors

<a href="https://github.com/solidjs/solid/graphs/contributors"><img src="https://opencollective.com/solid/contributors.svg?width=890&amp;button=false" style="max-width:100%;"></a>

### Open Collective

Support us with a donation and help us continue our activities. [[Contribute](https://opencollective.com/solid)]

<a href="https://opencollective.com/solid/backer/0/website" target="_blank"><img src="https://opencollective.com/solid/backer/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/1/website" target="_blank"><img src="https://opencollective.com/solid/backer/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/2/website" target="_blank"><img src="https://opencollective.com/solid/backer/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/3/website" target="_blank"><img src="https://opencollective.com/solid/backer/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/4/website" target="_blank"><img src="https://opencollective.com/solid/backer/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/5/website" target="_blank"><img src="https://opencollective.com/solid/backer/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/6/website" target="_blank"><img src="https://opencollective.com/solid/backer/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/7/website" target="_blank"><img src="https://opencollective.com/solid/backer/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/8/website" target="_blank"><img src="https://opencollective.com/solid/backer/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/9/website" target="_blank"><img src="https://opencollective.com/solid/backer/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/10/website" target="_blank"><img src="https://opencollective.com/solid/backer/10/avatar.svg"></a>

### Sponsors

Become a sponsor and get your logo on our README on GitHub with a link to your site. [[Become a sponsor](https://opencollective.com/solid#sponsor)]

<a href="https://opencollective.com/solid/sponsor/0/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/1/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/2/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/3/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/4/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/5/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/6/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/7/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/8/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/9/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/10/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/10/avatar.svg"></a>
