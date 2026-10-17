---
name: server-components
description: Rules for writing Solid 2.0 server components ("use server" functions that return a template) and their slots with @solidjs/web. Use when writing or reviewing a server component, deciding what lives on the server versus the client, or wiring a slot.
---

# Writing Solid server components with slots

A Solid server component is a `"use server"` function that returns a
template; the browser receives its markup and never its code. Anything the
client contributes goes through a **slot** on the component's props: a
client component the client places at a position in the server's markup.
This guide is the set of rules an author — a person or an agent — needs to
write one correctly the first time. The design record is
`documentation/server-components/server-components-principles.md`; this
file is the operative subset.

## Where things go

> **An element lives where the data that creates it lives.**

- Exists because of **server data** (a todo row, a nav link, a search
  form the server renders)? It is **server markup**. A mutation on it is a
  form `action` — it works without JavaScript, and the router marks a
  submission in flight (`aria-busy`) so CSS can show the intent.
- Needs **client behavior or client state** (a handler, an optimistic add,
  a modal, a drag ghost, an editor open over a field)? It is a **client
  component** placed through a **slot**.

When the client confirms an optimistic entity and the server renders it, the
row _becomes_ server markup; `$key` on the element reconciles the two.

## Slots

```tsx
import type { Slot } from "@solidjs/web/frames";

interface TodosProps {
  pending: Slot; // no props
  editor: Slot<{ id: string; title: string }>; // props from the server
}
```

A slot is placed as an element: `<props.pending />`,
`<props.editor id={t.id} title={t.title} />`. The client owns the nodes
between the slot's markers; the server's markup around them stays the
server's.

```tsx
export async function todoList() {
  "use server";
  const todos = await db.list();
  return (props: TodosProps) => (
    <ul>
      {todos.map(t => (
        <li $key={t.id}>
          {t.title}
          <props.editor $key={t.id} id={t.id} title={t.title} />
        </li>
      ))}
      <props.pending />
    </ul>
  );
}
```

The client passes the fill — a component of the slot's props:

```tsx
<Todos editor={p => <Editor id={p.id} title={p.title} />} pending={() => <For each={adds}>{…}</For>} />
```

- **The fill runs once per occurrence, as a component body does.** It runs
  untracked, under the occurrence's owner, with live props. State it
  creates (a signal, a memo, an `onCleanup`) lives as long as the
  occurrence. A top-level read is read once, and `STRICT_READ_UNTRACKED`
  names it ("the \`editor\` template-slot fill").
- **Place slots as JSX, not calls.** The compiler wraps each prop in a
  getter so the read defers to the slot border; a call form
  (`props.status({ … })`) evaluates its args eagerly in the server
  component's body.
- **`$key` is optional.** Add it when the fill holds its own state (an edit
  draft, a signal created inside) that must follow the entity across
  refetches and reorders.
- **An async value crosses with `asyncArg`.**
  `<props.status progress={asyncArg(gen.progress)} />` ships the promise or
  async iterable; the fill's read settles (suspends until the first value).

## Behavior on server markup

A handler on a server-rendered element cannot come from the server: a
server function never runs in the browser. Pick one:

- **A form.** A mutation is `<form action={…}>`; it works before
  JavaScript and needs no client code.
- **A client component that owns the element.** Move the control into a
  slot's fill (`<props.toggle id={t.id} done={t.completed} />`, rendering
  the checkbox on the client).
- **One delegated listener.** For many identical controls inside server
  markup (a copy button on every code block), place one slot occurrence
  whose component registers a single document listener in `onSettled` and
  finds its target from the event (`closest("button.copy-code")`). Inside a
  live hole this is the shape that keeps the hole streaming: a slot placed
  inside a live hole latches it (`SSR_LIVE_HOLE_LATCHED`, `data.cause`
  `"records"`). `examples/chat`'s Copy button is this shape.

## Shared components

One component can render on both sides. Put `$key={props.id}` on the
element it renders (morph identity) — the slot's own `$key` is a different
key for a different job. Do not read `document`/`window` during render;
that is the ordinary isomorphic rule.

## Compiling

With `@solidjs/vite-plugin`, `solid({ ssr: true, serverFunctions:
{ components: true } })` is the turnkey setup (the examples under
`examples/todos-server`, `examples/notes`, `examples/chat`).
