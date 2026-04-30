# RFC: TypeScript and JSX ownership

**Start here:** If you're migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 moves JSX type ownership out of `solid-js` and into renderer packages. The core package owns renderer-neutral component and child types. `@solidjs/web`, `@solidjs/h`, and custom renderers own their JSX namespaces, intrinsic elements, and `jsx-runtime` / `jsx-dev-runtime` type entries.

For web apps, TypeScript should resolve JSX from `@solidjs/web`:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web"
  }
}
```

## Motivation

`solid-js` is the renderer-neutral UI core, but its old TypeScript surface implicitly depended on DOM JSX types. That made non-web renderers and DOM-free TypeScript environments inherit web types even when they did not import `@solidjs/web`.

Renderer-owned JSX keeps the dependency direction aligned with runtime ownership:

```text
solid-js              // component model and renderer-neutral renderable values
@solidjs/web          // DOM JSX namespace and DOM intrinsic elements
@solidjs/h            // hyperscript JSX namespace
@solidjs/universal    // custom renderer primitive, renderer supplies JSX types
```

## Detailed design

### `solid-js` owns renderer-neutral renderable types

Core component and child APIs use `Element` from `solid-js`. It represents values Solid can carry through component trees without naming DOM node types.

```ts
import type { Element, Component, ParentComponent } from "solid-js";

const App: Component = () => "hello";
const Layout: ParentComponent = props => props.children;
```

Use this type for renderer-neutral component APIs. Do not import `JSX` from `solid-js`; it is no longer exported.

### Renderer packages own JSX namespaces

For DOM JSX, import renderer-specific helper types from `@solidjs/web`:

```ts
import type { ComponentProps, JSX } from "@solidjs/web";

type ButtonProps = ComponentProps<"button">;
type ClickHandler = JSX.EventHandler<HTMLButtonElement, MouseEvent>;
```

`@solidjs/web/jsx-runtime` and `@solidjs/web/jsx-dev-runtime` provide the TypeScript JSX namespace for web projects. `solid-js/jsx-runtime` and `solid-js/jsx-dev-runtime` are removed.

### Hyperscript JSX uses `@solidjs/h`

Projects using the automatic JSX transform with hyperscript should point `jsxImportSource` at `@solidjs/h`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@solidjs/h"
  }
}
```

`@solidjs/h` keeps its distinct JSX element surface because hyperscript can represent function elements in ways DOM JSX should not.

### Custom renderers provide their own JSX runtime types

Custom renderer packages should expose `./jsx-runtime` and `./jsx-dev-runtime` type entries and define their own `JSX` namespace. See [`@solidjs/universal`](../../packages/solid-universal/README.md#typescript-jsx) for a minimal template.

Renderer packages that vendor `dom-expressions` JSX declarations can specialize `JSX.Element` at build time with `dom-expressions-jsx-types`.

## Migration / replacement

| 1.x / old 2.0 beta                         | Replacement                                     |
| ------------------------------------------ | ----------------------------------------------- |
| `"jsxImportSource": "solid-js"`            | `"jsxImportSource": "@solidjs/web"` for web JSX |
| `solid-js/jsx-runtime`                     | `@solidjs/web/jsx-runtime`                      |
| `solid-js/jsx-dev-runtime`                 | `@solidjs/web/jsx-dev-runtime`                  |
| `import type { JSX } from "solid-js"`      | `import type { JSX } from "@solidjs/web"`       |
| `ComponentProps<"button">` from `solid-js` | `ComponentProps<"button">` from `@solidjs/web`  |
| Renderer-neutral `JSX.Element` annotations | `Element` from `solid-js`                       |

## Removals

| Removed from `solid-js`            | Replacement / notes                                              |
| ---------------------------------- | ---------------------------------------------------------------- |
| `JSX` namespace export             | Import renderer JSX types from the renderer package              |
| `JSXElement` alias                 | Use `Element` from `solid-js` for renderer-neutral values        |
| `solid-js/jsx-runtime`             | Use the renderer runtime, usually `@solidjs/web/jsx-runtime`     |
| `solid-js/jsx-dev-runtime`         | Use the renderer runtime, usually `@solidjs/web/jsx-dev-runtime` |
| DOM intrinsic element helper types | Import DOM helper types from `@solidjs/web`                      |

## Alternatives considered

- Keeping a renderer-neutral `JSX` namespace in `solid-js` was rejected because TypeScript's JSX namespace still becomes the source of renderer-specific intrinsic element and element-type behavior.
- Keeping `solid-js/jsx-runtime` as a compatibility re-export was rejected because it would continue to make `solid-js` look like the JSX owner and hide incorrect `jsxImportSource` configuration.
