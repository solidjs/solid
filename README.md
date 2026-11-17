<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=core&version=2.0" alt="SolidJS" />
</p>

[![Build Status](https://img.shields.io/github/actions/workflow/status/solidjs/solid/main-ci.yml?branch=main&logo=github&style=for-the-badge)](https://github.com/solidjs/solid/actions/workflows/main-ci.yml)
[![Coverage Status](https://img.shields.io/coveralls/github/solidjs/solid.svg?style=for-the-badge)](https://coveralls.io/github/solidjs/solid?branch=main)

[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=for-the-badge)](https://www.reddit.com/r/solidjs/)

**[Website](https://www.solidjs.com/) • [Docs](https://docs.solidjs.com/) • [Tutorial](https://docs.solidjs.com/tutorial) • [Playground](https://playground.solidjs.com/) • [Discord](https://discord.com/invite/solidjs)**

Solid is a declarative JavaScript library for building user interfaces. Instead of a Virtual DOM, it compiles templates to real DOM nodes and updates them with fine-grained reactivity. Declare your state and use it throughout your app — when a piece of state changes, only the code that depends on it re-runs.

## At a glance

```tsx
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2;

  // The component body runs once. Only `{doubled()}` updates when count changes.
  return <button onClick={() => setCount(c => c + 1)}>{doubled()}</button>;
}

render(() => <Counter />, document.getElementById("app")!);
```

Try it in our [Playground](https://playground.solidjs.com/).

<details>
<summary>Explain this!</summary>

Solid compiles your JSX to real DOM operations at build time. The component function runs once on mount; reactivity is per-expression, not per-render. The `{doubled()}` expression compiles to a tracked update that only touches that one DOM position when `count()` changes.

```js
import { template, delegateEvents, insert } from "@solidjs/web";
import { createSignal } from "solid-js";

const _tmpl$ = /*#__PURE__*/ template(`<button>`);

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2;

  return (() => {
    const _el$ = _tmpl$();
    _el$._$$click = () => setCount(c => c + 1);
    insert(_el$, doubled);
    return _el$;
  })();
}
delegateEvents(["click"]);
```

Reads update on the next microtask (or call `flush()` for synchronous interop). Effects are split into a tracking `compute` phase and a side-effecting `apply` phase — see the [docs](https://docs.solidjs.com) for the full model.

</details>

## Key features

- Fine-grained updates to the real DOM — no virtual DOM diff.
- Declarative reactive primitives (`createSignal`, `createMemo`, `createStore`).
- Render-once components — your component function is plain JavaScript that runs once.
- Automatic dependency tracking — reading reactive state subscribes to it.
- Microtask-batched updates with `flush()` for synchronous interop.
- First-class async: any computation can return a `Promise`/`AsyncIterable`; `<Loading>` is the boundary.
- Optimistic UI primitives (`createOptimistic`, `createOptimisticStore`) and structured `action(...)` mutations.
- Streaming SSR and progressive hydration.
- TypeScript-first, JSX-first, web-component friendly.
- Universal: write custom renderers via [`@solidjs/universal`](packages/universal) to target non-DOM platforms.

## Quick start

Start from a [template](https://github.com/solidjs/templates):

```sh
npx degit solidjs/templates/solid-v2/basic my-app
cd my-app
npm install
npm run dev
```

Or add Solid to an existing Vite project:

```sh
npm i solid-js @solidjs/web
npm i -D vite @solidjs/vite-plugin
```

```js
// vite.config.ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()]
});
```

and point TypeScript at the web JSX types:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web"
  }
}
```

`solid-js` owns renderer-neutral component types, while renderer packages such as `@solidjs/web` and `@solidjs/h` own their JSX namespaces and `jsx-runtime` type entries.

### Coming from Solid 1.x?

Read the [migration guide](documentation/solid-2.0/MIGRATION.md). Solid 1.x is maintained on the [`1.x` branch](https://github.com/solidjs/solid/tree/1.x), installs with `npm i solid-js@v1-latest`, and its docs are at [v1.solidjs.com](https://v1.solidjs.com).

## For LLMs / AI assistants

The public API differs from any Solid examples that predate 2.0. Before generating Solid 2.0 code, read:

- [`packages/solid/skills/solid-2.0/SKILL.md`](packages/solid/skills/solid-2.0/SKILL.md) — the primer: the three rules that matter most, the 1.x → 2.0 corrections, and the primitives to reach for, in under 8 KB.
- [`packages/solid/CHEATSHEET.md`](packages/solid/CHEATSHEET.md) — one-page reference; the bottom enumerates patterns that changed from 1.x.
- [`documentation/solid-2.0/MIGRATION.md`](documentation/solid-2.0/MIGRATION.md) — full migration guide.
- [docs.solidjs.com](https://docs.solidjs.com) — the docs, with `/llms.txt` and `/llms-full.txt`.

The primer and the cheatsheet ship inside the `solid-js` npm package (`node_modules/solid-js/skills/solid-2.0/SKILL.md`, `node_modules/solid-js/CHEATSHEET.md`; the build also emits the cheatsheet as the `solid-2.0-cheatsheet` skill). The packages carry the `tanstack-intent` keyword, so skill registries that scan `node_modules` find them.

## Repository

This is a PNPM workspaces monorepo. The core runtime (`solid-js`, `@solidjs/signals`, `@solidjs/web`, `@solidjs/universal`, `@solidjs/diagnostics`) always shares one version. The two compilers share a version when they release together, and `@solidjs/h`, `@solidjs/html` and `@solidjs/element` version on their own.

| Package                 | Path                    | Purpose                                                               |
| ----------------------- | ----------------------- | --------------------------------------------------------------------- |
| `solid-js`              | `packages/solid`        | Core runtime — components, flow controls, context, hydration.         |
| `@solidjs/signals`      | `packages/signals`      | Reactive primitives — signals, memos, effects, stores.                |
| `@solidjs/web`          | `packages/web`          | Web platform runtime — `render`, `hydrate`, SSR, `Portal`, `dynamic`. |
| `@solidjs/h`            | `packages/h`            | Hyperscript / JSX factory.                                            |
| `@solidjs/html`         | `packages/html`         | Build-less tagged template literals.                                  |
| `@solidjs/universal`    | `packages/universal`    | Universal runtime for custom renderers.                               |
| `@solidjs/element`      | `packages/element`      | Web Components wrapper.                                               |
| `@solidjs/compiler`     | `packages/compiler`     | Native Oxc JSX compiler.                                              |
| `@solidjs/babel-plugin` | `packages/babel-plugin` | Babel plugin for JSX compilation.                                     |
| `@solidjs/diagnostics`  | `packages/diagnostics`  | Dev-only diagnostics and attribution harness for tests and agents.    |

Runtime DOM operations live in `@solidjs/web` (and `@solidjs/universal` / `@solidjs/h` / `@solidjs/html`). The JSX compilers and the DOM runtime live in this repo, so file their issues here, not on [DOM Expressions](https://github.com/ryansolid/dom-expressions). The API reference in one page is [`packages/solid/CHEATSHEET.md`](packages/solid/CHEATSHEET.md), and the design notes are under [`documentation/solid-2.0/`](documentation/solid-2.0/).

## Why Solid?

### Performant

Engineered for performance with years of research behind it — Solid's runtime cost is close to optimized vanilla JavaScript on the [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html). Small, fully tree-shakable, fast on the server too. ([Read more](https://dev.to/ryansolid/thinking-granular-how-is-solidjs-so-performant-4g37) about Solid's performance.)

### Powerful

Performant state management is built in (Context, Stores, Projections). Async is a first-class capability of computations, with `<Loading>` / `<Errored>` boundaries and `isPending` for revalidation indicators. Full SSR, streaming, and progressive hydration when you're ready to move to the server.

### Pragmatic

Components are plain functions. Rendering is determined by how state is used — no rendering system to learn. Read-write segregation is encouraged but not enforced.

### Productive

Built on JSX and TypeScript, integrates with the Vite ecosystem. Bare-metal abstractions give you direct access to the DOM. Growing ecosystem of [primitives](https://github.com/solidjs-community/solid-primitives), [component libraries](https://kobalte.dev), and build-time utilities.

## More

- [Documentation](https://docs.solidjs.com)
- [Tutorial](https://docs.solidjs.com/tutorial)
- [Examples](examples/)
- [Playground](https://playground.solidjs.com/)

## Browser support

SolidJS Core supports the last 2 years of modern Firefox, Safari, Chrome, and Edge (desktop and mobile). IE and similar sunset browsers are not supported. For server environments, Node LTS, the latest Deno, and Cloudflare Worker runtimes are supported.

## Community

Come chat on [Discord](https://discord.com/invite/solidjs). Solid's maintainers are active there, and we're always looking for contributions.

### Contributors

<a href="https://github.com/solidjs/solid/graphs/contributors"><img src="https://contrib.rocks/image?repo=solidjs/solid" style="max-width:100%;"></a>

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
<a href="https://opencollective.com/solid/sponsor/11/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/11/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/12/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/12/avatar.svg"></a>
