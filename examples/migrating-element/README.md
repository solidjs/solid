# Migrating Element

A side-by-side demo of one of Solid 2.0's quieter superpowers: a single DOM
element can be **referenced from multiple JSX slots** and the runtime will
migrate the node — preserving its identity and every piece of state attached
to it — instead of destroying and re-creating it.

## What you'll see

The page renders a `<canvas>` and three layout slots: a hero stage, a
picture-in-picture corner, and a bottom dock. Buttons let you choose which slot
the canvas lives in. A `requestAnimationFrame` loop continuously draws a
SolidJS logo onto the canvas; clicking either canvas adds a colored splat
at the cursor position.

Two panels render the same set of slots side-by-side:

| Panel | What it does | What you see |
| --- | --- | --- |
| **Left (✓ Persistent)** | Stores the `<Canvas />` JSX once and reuses the same expression in every `<Show>` slot. | The logo keeps drawing across every slot switch, and every splat you painted stays exactly where you put it. |
| **Right (✗ Re-created)** | Writes `<Canvas />` inline inside every `<Show>` slot, returning a brand-new `<canvas>` each time. | Every move tears the element down and constructs a new one — bitmap resets, splats vanish, and the logo starts drawing again. |

## Why other frameworks can't do this directly

The pattern reduces to: _the same DOM element identity participates in
multiple different render positions._ In React this isn't expressible at all
— element identity is tied 1-to-1 to JSX position; even portals create fresh
DOM on every position change. Vue's `<Teleport>` can move a subtree between
targets atomically, but only by changing one `to` prop, not by referencing
the same element from multiple `v-if` slots. Svelte has no native primitive
at all.

Solid 2.0's compiler-emitted `insert`/`reconcile` paths now recognise this
migration shape and resolve it to a single `insertBefore` per slot toggle.

This resolves the long-standing bug class reported as
[solidjs/solid#2030](https://github.com/solidjs/solid/issues/2030) and
[solidjs/solid#2357](https://github.com/solidjs/solid/issues/2357) — a single
node referenced from multiple sibling slots used to either crash
`replaceChild` ("new child contains the parent") or vanish during sibling-slot
cleanup. The new dom-expressions runtime tags each node with the slot that
owns it and gates every destructive operation on that ownership, so a
migration becomes a single move.

## What survives a migration

- JS object identity
- Expandos and custom properties set on the element
- Event listeners — both delegated and native `addEventListener`
- `requestAnimationFrame` loops keyed to the element's state
- Canvas bitmap state, scroll position, focus (when the move is atomic),
  `<details>` open state, custom-element internal state, web-component
  shadow DOM, MSE source buffers — anything that lives on the element rather
  than on its position in the document tree.

## Caveats worth knowing

- **Reactive ownership is unchanged.** Migration only moves the DOM node;
  it does not transfer the effects/signals that were created with the
  surrounding `<Show>` scope. If you want long-lived state, declare it
  outside any scope that may dispose.
- **Native `connected` / `disconnected` callbacks fire.** Custom elements
  treat every reparent as a new connection. If your element carries a
  `disconnectedCallback` that resets state, the move still triggers it.
- **Media elements (`<video>`, `<audio>`) pause on disconnect.** The HTML
  spec runs *internal pause steps* the moment a media element leaves the
  document tree, even for a microsecond. Migration preserves the JS object,
  listeners, expandos, `currentTime`, and buffer — but playback stops at
  the moment of the move and must be resumed (`.play()`) afterward. Canvas
  has no such caveat, which is why this demo uses one.
- **One DOM node, one position at a time.** A node can only exist in one
  parent at any moment. The migration moves it; it does not clone.

## Running

```bash
pnpm install
pnpm --filter migrating-element-example dev
# in another terminal
pnpm --filter migrating-element-example start
```

Open <http://localhost:3003>.
