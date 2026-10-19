# @solidjs/web

Solid 2.0's web platform runtime — DOM rendering, hydration, server-side rendering, and the web-only control-flow components (`Portal`, `Dynamic`).

> **Solid 2.0 (Release Candidate).** In 1.x this package was the `solid-js/web` subpath; in 2.0 it's a separate `@solidjs/web` package.
>
> See [`solid-js`'s CHEATSHEET](https://github.com/solidjs/solid/blob/next/packages/solid/CHEATSHEET.md) and [MIGRATION guide](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md) for the 2.0 surface.

## Entry points

```ts
// Browser / hydration
import { render, hydrate, Portal, Dynamic, dynamic } from "@solidjs/web";

// Server (SSR)
import { renderToString, renderToStream, isServer } from "@solidjs/web";
```

The control-flow components from `solid-js` (`For`, `Show`, `Switch`/`Match`, `Loading`, `Errored`, `Repeat`, `Reveal`) are also re-exported from `@solidjs/web` for convenience.

## Deferred hydration

`DeferredHydration` always renders its children on the server. In the browser,
`when={false}` leaves those exact server nodes in place without running their
components. When `when` becomes true, Solid claims that subtree in its original
hydration owner and replays queued events. Changing `when` back to false does
not unmount it.

```tsx
import { createSignal, onSettled } from "solid-js";
import { DeferredHydration } from "@solidjs/web";

function DeferredWidget() {
  const [ready, setReady] = createSignal(false);
  onSettled(() => {
    const id = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(id);
  });
  return (
    <DeferredHydration when={ready()} fallback={<p>Loading widget</p>}>
      <Widget />
    </DeferredHydration>
  );
}
```

Set up the readiness trigger outside the deferred children. Nested boundaries
can activate independently once their parent is claimed. A boundary disposed
before activation never runs its children. During a client-only render, the
optional `fallback` is shown until activation; during hydration the existing
server content stays visible instead. Async children can use `Loading` inside
the boundary as usual.

## More

- [Documentation](https://v2.solidjs.com)
- [Cheatsheet (2.0 public API)](https://github.com/solidjs/solid/blob/next/packages/solid/CHEATSHEET.md)
- [Migration guide (1.x → 2.0)](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md)
