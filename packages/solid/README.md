<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=core" alt="SolidJS" />
</p>

[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)

**[Website](https://www.solidjs.com/) • [API Docs](https://docs.solidjs.com/) • [Tutorial](https://www.solidjs.com/tutorial/introduction_basics) • [GitHub](https://github.com/solidjs/solid) • [Discord](https://discord.com/invite/solidjs)**

> **You are looking at Solid 2.0 (experimental beta).**
> Public surface differs from 1.x — split-phase `createEffect`, microtask batching, `Loading`/`Errored` boundaries, draft-first store setters, async-in-computations, removed `solid-js/web` and `solid-js/store` subpaths, and more.
>
> - **Migrating from 1.x?** Read [MIGRATION.md](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md) (full guide).
> - **Need a quick API reference?** See [CHEATSHEET.md](./CHEATSHEET.md) (one page, every public export — ships with this package).
> - **Looking for stable Solid 1.x?** Use the default [`main` branch](https://github.com/solidjs/solid).

Solid is a declarative JavaScript library for building user interfaces. Instead of a Virtual DOM, it compiles templates to real DOM nodes and updates them with fine-grained reactivity. Declare your state and use it throughout your app — when a piece of state changes, only the code that depends on it re-runs.

## At a glance (Solid 2.0)

```tsx
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2;

  return (
    <button onClick={() => setCount(c => c + 1)}>
      {doubled()}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
```

Try it in our [Playground](https://playground.solidjs.com/). _(The hosted Playground currently runs Solid 1.x — a 2.0 build is on the way.)_

The component body runs **once**. The `{doubled()}` expression is the only thing that re-renders when `count` changes — Solid compiles JSX to real DOM nodes and tracks the `count()` read at that one DOM position.

## Install

```sh
npm i solid-js @solidjs/web
npm i -D babel-preset-solid
```

Add `babel-preset-solid` to your Babel config (or use Vite's Solid plugin), and set `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  }
}
```

Existing 1.x starter templates target 1.x — 2.0 starter templates are tracked at [solidjs/templates](https://github.com/solidjs/templates).

## For LLMs / AI assistants

If you're an AI tool or model generating Solid 2.0 code: the public API differs from any Solid examples that predate 2.0. Read [`CHEATSHEET.md`](./CHEATSHEET.md) before generating — it lives inside this package (`node_modules/solid-js/CHEATSHEET.md`) for that reason. The bottom of the cheatsheet enumerates the specific patterns that changed from 1.x.

The full migration guide is [`MIGRATION.md`](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md). Eight RFCs covering each subsystem (reactivity, control flow, stores, async, actions, DOM, dev-mode diagnostics) live alongside it under [`documentation/solid-2.0/`](https://github.com/solidjs/solid/tree/next/documentation/solid-2.0).

## Learn more

- **Why Solid, key features, browser support, community, sponsors** — see the [repository README](https://github.com/solidjs/solid#readme).
- **Full documentation** — [docs.solidjs.com](https://docs.solidjs.com).
- **Examples** — [documentation/resources/examples.md](https://github.com/solidjs/solid/blob/next/documentation/resources/examples.md).
- **Discord** — [discord.com/invite/solidjs](https://discord.com/invite/solidjs).

---

_This is the npm package README for `solid-js`. The full repository README — including the monorepo layout, contributors, and sponsors — lives at [github.com/solidjs/solid](https://github.com/solidjs/solid#readme)._
