<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=core&version=2.0" alt="SolidJS" />
</p>

[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)

**[Website](https://www.solidjs.com/) • [Docs](https://docs.solidjs.com/) • [Tutorial](https://docs.solidjs.com/tutorial) • [Playground](https://playground.solidjs.com/) • [GitHub](https://github.com/solidjs/solid) • [Discord](https://discord.com/invite/solidjs)**

Solid is a declarative JavaScript library for building user interfaces. Instead of a Virtual DOM, it compiles templates to real DOM nodes and updates them with fine-grained reactivity. Declare your state and use it throughout your app — when a piece of state changes, only the code that depends on it re-runs.

## At a glance

```tsx
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2;

  return <button onClick={() => setCount(c => c + 1)}>{doubled()}</button>;
}

render(() => <Counter />, document.getElementById("app")!);
```

Try it in our [Playground](https://playground.solidjs.com/).

The component body runs **once**. The `{doubled()}` expression is the only thing that re-renders when `count` changes — Solid compiles JSX to real DOM nodes and tracks the `count()` read at that one DOM position.

## Install

Start from a [template](https://github.com/solidjs/templates), or add Solid to a Vite project:

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

Set `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web"
  }
}
```

For web projects, `jsxImportSource` points at `@solidjs/web`. `solid-js` owns renderer-neutral component types, while renderer packages such as `@solidjs/web` and `@solidjs/h` own their JSX namespaces and `jsx-runtime` type entries.

### Coming from Solid 1.x?

Read the [migration guide](https://github.com/solidjs/solid/blob/main/documentation/solid-2.0/MIGRATION.md). Solid 1.x is maintained on the [`1.x` branch](https://github.com/solidjs/solid/tree/1.x), installs with `npm i solid-js@v1-latest`, and its docs are at [v1.solidjs.com](https://v1.solidjs.com).

## For LLMs / AI assistants

If you're an AI tool or model generating Solid 2.0 code: the public API differs from any Solid examples that predate 2.0. Start with the primer skill, [`skills/solid-2.0/SKILL.md`](./skills/solid-2.0/SKILL.md) (`node_modules/solid-js/skills/solid-2.0/SKILL.md`): the three rules that matter most, the 1.x → 2.0 corrections, and the primitives to reach for. Then read [`CHEATSHEET.md`](./CHEATSHEET.md) (`node_modules/solid-js/CHEATSHEET.md`, also shipped as the `solid-2.0-cheatsheet` skill) — the bottom enumerates the specific patterns that changed from 1.x. The docs are at [docs.solidjs.com](https://docs.solidjs.com) (`/llms.txt`, `/llms-full.txt`).

The full migration guide is [`MIGRATION.md`](https://github.com/solidjs/solid/blob/main/documentation/solid-2.0/MIGRATION.md). The 2.0 RFCs covering each subsystem live alongside it under [`documentation/solid-2.0/`](https://github.com/solidjs/solid/tree/main/documentation/solid-2.0).

## Learn more

- **Why Solid, key features, browser support, community, sponsors** — see the [repository README](https://github.com/solidjs/solid#readme).
- **Full documentation** — [docs.solidjs.com](https://docs.solidjs.com).
- **Interactive tutorial** — [docs.solidjs.com/tutorial](https://docs.solidjs.com/tutorial).
- **Examples** — the [`examples/`](https://github.com/solidjs/solid/tree/main/examples) folder (see [`documentation/archive/plans/examples-grid-plan.md`](https://github.com/solidjs/solid/blob/main/documentation/archive/plans/examples-grid-plan.md) for the grid they cover).
- **Discord** — [discord.com/invite/solidjs](https://discord.com/invite/solidjs).

---

_This is the npm package README for `solid-js`. The full repository README — including the monorepo layout, contributors, and sponsors — lives at [github.com/solidjs/solid](https://github.com/solidjs/solid#readme)._
