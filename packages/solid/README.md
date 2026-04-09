<div align="center">

[![Banner](https://assets.solidjs.com/banner?project=library&type=core)](https://github.com/solidjs)

[![Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge&color=blue&logo=npm)](https://npmjs.com/package/solid-js)
[![Downloads](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge&color=green&logo=npm)](https://npmjs.com/package/solid-js)
[![Stars](https://img.shields.io/github/stars/solidjs/solid?style=for-the-badge&color=yellow&logo=github)](https://github.com/solidjs/solid)
[![Discord](https://img.shields.io/discord/722131463138705510?label=join&style=for-the-badge&color=5865F2&logo=discord&logoColor=white)](https://discord.com/invite/solidjs)
[![Reddit](https://img.shields.io/reddit/subreddit-subscribers/solidjs?label=join&style=for-the-badge&color=FF4500&logo=reddit&logoColor=white)](https://reddit.com/r/solidjs)

</div>

**Solid** is a declarative JavaScript library for building fast, reactive user interfaces. Instead of relying on a Virtual DOM, Solid compiles your components directly into real DOM nodes and updates them with fine-grained reactions.

Explore the official [documentation](https://docs.solidjs.com) for detailed guides and examples.

## At a Glance

Run this code snippet in our [playground](https://playground.solidjs.com/anonymous/c90f7c00-9b86-451f-8e18-81d202089c19) and watch our [introduction video](https://youtube.com/watch?v=cELFZQAMdhQ)

```jsx
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

function Counter() {
  const [count, setCount] = createSignal(0);

  const doubleCount = () => count() * 2;

  console.log("The body of the function runs once");

  return (
    <button onClick={() => setCount((c) => c + 1)}>
      Increment: {doubleCount()}
    </button>
  );
}

render(Counter, document.getElementById("app"));
```

## Core Features

- **Fine-grained reactivity:** updates propagate directly to DOM nodes, not component trees, making Solid nearly identical in performance to vanilla JS ([see benchmark](https://krausest.github.io/js-framework-benchmark/current.html))
- **Render-once components:** component functions execute once to set up the reactive graph
- **Automatic dependency tracking:** accessing a reactive value inside an effect or computation automatically subscribes to it
- **Composable reactive primitives:** primitives like [`createSignal`](https://docs.solidjs.com/reference/basic-reactivity/create-signal), [`createEffect`](https://docs.solidjs.com/reference/basic-reactivity/create-effect), and [`createMemo`](https://docs.solidjs.com/reference/basic-reactivity/create-memo) are simple building blocks that combine naturally for any data flow
- **First-class async & data fetching:** [`createResource`](https://docs.solidjs.com/reference/basic-reactivity/create-resource) models async data as reactive state and pairs seamlessly with `<Suspense>` for fluid loading experiences
- **Full SSR & streaming:** server-side rendering with streaming and progressive hydration gets users to interactive faster, whether you're building a classic SSR app or going serverless
- **Modern DX:** JSX, TypeScript, Vite integration, and direct DOM access mean your favorite libraries and devtools just work
- **Small bundle:** tree-shakable and bundle-friendly, Solid adds [minimal](https://bundlephobia.com/package/solid-js) overhead to your shipped code
- **Batteries included:** [Context](https://docs.solidjs.com/reference/component-apis/create-context), [Portals](https://docs.solidjs.com/reference/components/portal), [lazy loading](https://docs.solidjs.com/reference/component-apis/lazy), Web Component authoring, and custom renderers all ship in the box

## Quick Start

Create a template project with your preferred package manager

```bash
# using npm
npm create solid@latest
```

```bash
# using pnpm
pnpm create solid@latest
```

```bash
# using bun
bun create solid@latest
```

Select the _SolidJS + Vite_ option, or choose _SolidStart_ for a full-stack setup.

## Ecosystem

Solid has a growing ecosystem of first-party and community packages covering routing, UI components, state management, and more.

**Featured**

| Package                                                                       | Description                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [**Solid Start**](https://github.com/solidjs/solid-start)                     | Full-stack meta-framework with file-based routing, SSR, streaming, and serverless support     |
| [**Solid Router**](https://github.com/solidjs/solid-router)                   | Universal router for client and server with nested routes, data preloading, and lazy loading  |
| [**Solid Meta**](https://github.com/solidjs/solid-meta)                       | Async, SSR-ready head management for Solid apps, anywhere in the component tree               |
| [**Solid Primitives**](https://github.com/solidjs-community/solid-primitives) | 70+ high-quality, composable reactive utilities — timers, sensors, network, storage, and more |
| [**Kobalte**](https://kobalte.dev)                                            | Accessible, unstyled UI component library built for Solid, inspired by Radix UI               |

Browse the full ecosystem at [ecosystem.solidjs.com](https://solidjs.com/ecosystem)

---

## Contributing

Contributions are always welcome! Check out [CONTRIBUTING.md](../../CONTRIBUTING.md) to get started and join the conversation on [Discord](https://discord.com/invite/solidjs).

If Solid has helped you, consider supporting the project on [OpenCollective](https://opencollective.com/solid).
Sponsorship helps sustain core development and the ecosystem.

**Organizations**

[![organizations](https://opencollective.com/solid/organizations.svg?width=1000&button=false&avatarHeight=60)](https://opencollective.com/solid)

**Individuals — Top 20**

[![individuals](https://opencollective.com/solid/individuals.svg?width=1000&limit=20&button=false&avatarHeight=60)](https://opencollective.com/solid)
