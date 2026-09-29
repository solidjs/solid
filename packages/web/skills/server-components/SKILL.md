# Writing Solid server components with slots

A Solid server component is a `"use server"` function that returns a
template; the browser receives its markup and never its code. Anything the
client contributes goes through a **slot** on the component's props. This
guide is the set of rules an author — a person or an agent — needs to write
one correctly the first time. The design record is
`documentation/server-components/server-components-principles.md` §9.2.3;
this file is the operative subset.

## Where things go

> **An element lives where the data that creates it lives.**

- Exists because of **server data** (a todo row, a nav link, a search
  form the server renders)? It is **server markup**. Client behavior or a
  client-driven value on it is an **attribute slot** — bind, never wrap.
  Do not wrap a server-rendered element in a client component to give it a
  handler or a class.
- Exists because of **client state alone** (an optimistic add, a modal, a
  drag ghost, an editor open over a field)? It is a **client component**
  placed through a **markup slot**.

When the client confirms an optimistic entity and the server renders it, the
row _becomes_ server markup; `$key` on the element reconciles the two.

## The two kinds of slot

```tsx
import type { AttributeSlot, Slot } from "@solidjs/web/frames";

interface TodosProps {
  pending: Slot; // markup: the client returns JSX
  row: AttributeSlot<{ id: string; completed: boolean }, RowBehavior>; // attributes: the client returns an object
  filters: AttributeSlot<{}, FilterBehavior>; // no args: called bare
}
```

A **markup slot** is placed as an element: `<props.pending />`. The client
owns those nodes.

An **attribute slot** is _called_ once per data context and its properties
are _bound_ at positions of the server's own template:

```tsx
export async function todoList() {
  "use server";
  const todos = await db.list();
  return (props: TodosProps) => {
    const filters = props.filters();
    return (
      <>
        <ul>
          {todos.map(t => (
            <TodoRow
              id={t.id}
              title={t.title}
              row={props.row({ id: t.id, completed: t.completed })}
            />
          ))}
          <props.pending />
        </ul>
        <a href="#/" class={{ selected: filters.all }}>
          All
        </a>
      </>
    );
  };
}
```

The client passes the fill — a function of the args that returns the object:

```tsx
<Todos row={rowFor} filters={() => ({ all: filter() === "all", … })} pending={() => <For each={adds}>{…}</For>} />
```

## The one rule for attribute slots

> **A slot property is a JSX attribute value, whole, and nothing else.**

Legal positions: an attribute (`hidden={row.removed}`, `checked={row.done}`,
`title={row.error}`), a class name inside object form
(`class={{ completed: row.done }}`), the whole `class`/`style`
(`class={row.rowClass}`), a style property (`style={{ opacity: row.fade }}`),
an event (`onInput={row.onToggle}`), a ref (`ref={row.ref}`) — on an element
with a spread too (`<button {...rest} onClick={row.go} />` — the last
source that has the key wins, `undefined` included, as the client's
spread reads it). Not a `prop:*`
property, not a text child, not inside another slot call's args (nested in
plain objects and arrays included). Reserved keys the fill must not use:
keys beginning with `$` or a digit, `length`, `slice`, `t`/`h`/`p`, `then`,
`constructor`/`toString`/`valueOf`/`toJSON`; anything else (`filter`, `map`
included) is a plain property.

The server **does not have the value** — on the stream face a property read
is a stand-in with no value, on the document face only the initial one — so
nothing can be computed from it on the server. Every one of these is wrong:

| Wrong                                                                  | Why                                                                                   | Write instead                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ``class={`todo ${row.done}`}``                                         | stringified: not the whole value                                                      | `class={{ todo: true, completed: row.done }}` or return `rowClass` from the fill               |
| `row.count > 3 ? "a" : "b"`                                            | comparison on a stand-in                                                              | decide in the fill; return the decided value                                                   |
| `if (row.error) …`, `row.error && <button/>`, `<Show when={row.done}>` | truthiness: a stand-in is an object and **always truthy** — the branch always renders | presence → `hidden={…}` or a class; a node that exists because of client state → a markup slot |
| `<strong>{row.count}</strong>`                                         | text is not a bindable position yet                                                   | a markup slot for the text                                                                     |
| `format(row.title)` (a server helper)                                  | the helper receives a stand-in                                                        | do the formatting in the fill                                                                  |
| `<li {...row}>`                                                        | spread: the template must show what the client owns                                   | name each position                                                                             |
| `onClick={() => …}` on a server element                                | a server function can never run in the browser                                        | bind a slot property or a form `action`                                                        |

Every case except truthiness is a dev finding (`ATTRIBUTE_SLOT_POSITION`)
and renders **nothing on either face**, so it shows on the first render.
Truthiness has no runtime hook: if a retry button appears on every row, this
is why.

## Writing the fill

- **Values as getters, handlers as plain closures** when a shared client
  component also consumes the object (the usual case):

  ```tsx
  const rowFor = (p: { id: string; completed: boolean }): RowBehavior => ({
    get rowClass() {
      return { todo: true, completed: done(p.id, p.completed), pending: !!intent.byId[p.id] };
    },
    get done() {
      return done(p.id, p.completed);
    },
    get removed() {
      return removed(p.id);
    },
    onToggle: e => actions.toggle(p.id, e.currentTarget.checked),
    onRemove: () => actions.remove(p.id)
  });
  ```

  A client `<TodoRow row={rowFor(todo)} />` reads `props.row.onToggle` once,
  untracked, in its body; a plain-value fill would do its reactive reads
  there and never update (`STRICT_READ_UNTRACKED` names it). Getters move
  each read to the position that binds it. Plain values are fine when only
  the server template reads the object.

- **Name it like a props interface**, because it is one (a shared component
  takes it as a prop). Handlers are `on` + intent — `onToggle`, `onRemove`,
  `onCopy`, `onClearCompleted`; the position names the DOM event, the key
  names the meaning, as a component's `onSelect` does. Values are nouns or
  adjectives (`done`, `rowClass`, `error`, `busy`); a ref is `ref`. The
  runtime reads nothing into the prefix — the position decides what a
  property is — but a reader can tell a handler from a value without
  opening the type.
- The fill runs once per occurrence (one call); each bound position tracks
  its own reads; handlers dispatch to the fill's _current_ handler; a ref
  fires once per element.
- **`$key` is optional.** A call repeated within a render (a component
  prop re-evaluates it per position) is one occurrence either way. Add
  `$key: t.id` when the fill holds its own state (an edit draft, a signal
  created inside) that must follow the entity across refetches and
  reorders. Values never depend on it.
- Reserved keys in the returned object: anything beginning with `$`, the
  node keys `t` `h` `p` `then`, and `Object`/`Array` prototype member names
  (`length`, `map`, …).

## Shared components

One component can render on both sides: on the server its `row` prop is
the attribute slot's return, on the client it is the fill's result. It
cannot tell and need not. Put `$key={props.id}` on the element it renders
(morph identity) — the slot call's own `$key` is a different key for a
different job. Do not read `document`/`window` during render; that is the
ordinary isomorphic rule.

## Compiling

Server components need the SSR compile with the `serverComponents` compiler
option. With `@solidjs/vite-plugin`, `solid({ ssr: true, serverFunctions:
{ components: true } })` is the turnkey setup (the examples under
`examples/todos-server`, `examples/notes`, `examples/chat`); a hand-rolled
build passes `serverComponents: true` to `@solidjs/compiler` or
`@solidjs/babel-plugin` for the SSR side. Without it a dynamic
`class`/`style` compiles inside the template's quotes, where a slot value
cannot be marked — the `inline` finding below.

## Diagnostics

`ATTRIBUTE_SLOT_POSITION` (`data.reason`):

| reason         | severity       | what happened                                                                                                                                   | fix                                                                                                                                                               |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spread`       | error (throws) | a slot's return was spread onto an element                                                                                                      | name each position                                                                                                                                                |
| `stringified`  | warn           | template literal / concatenation                                                                                                                | whole value at one position                                                                                                                                       |
| `coerced`      | warn           | comparison, arithmetic, `==`                                                                                                                    | decide in the fill                                                                                                                                                |
| `text`         | warn           | placed as a text child                                                                                                                          | markup slot                                                                                                                                                       |
| `inline`       | warn           | reached `class`/`style` inside template quotes                                                                                                  | compile with `serverComponents: true`                                                                                                                             |
| `markup`       | warn           | the fill returned JSX but the template read a property                                                                                          | return an object, or place the slot                                                                                                                               |
| `server-local` | warn           | a server function at `on*`/`ref`                                                                                                                | bind a slot property                                                                                                                                              |
| `reserved-key` | warn           | the fill used a reserved key                                                                                                                    | rename it                                                                                                                                                         |
| `arg`          | warn           | a slot property passed in another slot call's argument (nested in plain objects/arrays; `data.path`)                                            | pass the server's own value, or read it in the fill from client state                                                                                             |
| `prop`         | warn           | a slot property at a `prop:*` key of a spread                                                                                                   | bind the attribute form, or set the property in the fill's ref                                                                                                    |
| `fill-shape`   | warn (client)  | the fill returned a non-object (`null`, array, DOM node, primitive), or the prop read as data is not a function                                 | return a plain object from a function prop                                                                                                                        |
| `orphan`       | warn (client)  | markers for an occurrence that can never bind: `data.why` `"fill"` — no fill for the prop; `"record"` — a called occurrence with no args record | `fill`: pass the prop / match the name on both sides. `record`: not the fill — rebuild client and server together (stale prebundle, cached asset), else report it |

Every reason but `fill-shape` and `orphan` comes from the server render.
`orphan` is the one failure this model cannot otherwise show you: the
element is inert — a handler that never fires, a class that never updates —
with no error.

`STRICT_READ_UNTRACKED` inside a fill: use getters (above).
