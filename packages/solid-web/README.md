# @solidjs/web

Solid 2.0's web platform runtime — DOM rendering, hydration, server-side rendering, and the web-only control-flow components (`Portal`, `Dynamic`).

> **Solid 2.0 (experimental beta).** In 1.x this package was the `solid-js/web` subpath; in 2.0 it's a separate `@solidjs/web` package.
>
> See [`solid-js`'s CHEATSHEET](https://github.com/solidjs/solid/blob/next/packages/solid/CHEATSHEET.md) and [MIGRATION guide](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md) for the 2.0 surface.

## Entry points

```ts
// Browser / hydration
import { render, hydrate, Portal, Dynamic, dynamic } from "@solidjs/web";

// Server (SSR)
import {
  renderToString,
  renderToStringAsync,
  renderToStream,
  isServer
} from "@solidjs/web";
```

The control-flow components from `solid-js` (`For`, `Show`, `Switch`/`Match`, `Loading`, `Errored`, `Repeat`, `Reveal`) are also re-exported from `@solidjs/web` for convenience.

## More

- [Documentation](https://docs.solidjs.com)
- [Cheatsheet (2.0 public API)](https://github.com/solidjs/solid/blob/next/packages/solid/CHEATSHEET.md)
- [Migration guide (1.x → 2.0)](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md)
