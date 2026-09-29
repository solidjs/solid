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
  client-driven value on it is a **binding slot** — bind, never wrap.
  Do not wrap a server-rendered element in a client component to give it a
  handler or a class.
- Exists because of **client state alone** (an optimistic add, a modal, a
  drag ghost, an editor open over a field)? It is a **client component**
  placed through a **template slot**.

When the client confirms an optimistic entity and the server renders it, the
row _becomes_ server markup; `$key` on the element reconciles the two.

## The two kinds of slot

```tsx
import type { BindingSlot, Slot } from "@solidjs/web/frames";

interface TodosProps {
  pending: Slot; // template: the client returns JSX
  row: BindingSlot<{ id: string; completed: boolean }, RowBehavior>; // bindings: the client returns an object
  filters: BindingSlot<{}, FilterBehavior>; // no args: called bare
}
```

A **template slot** is placed as an element: `<props.pending />`. The client
owns those nodes.

A **binding slot** is _called_ once per data context and its properties
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
<Todos row={rowFor} filters={() => ({ get all() { return filter() === "all"; }, … })} pending={() => <For each={adds}>{…}</For>} />
```

The fill must return a plain object. An array, a DOM node, a function or
an async value is a type error on both sides (`BindingSlot`'s return is
`SlotOutput<J>`, a branded `SlotError` naming the reason) and a
`fill-shape` finding at runtime.

## The one rule for binding slots

> **A slot property is a JSX attribute value or a text child, whole, and nothing else.**

Legal positions: an attribute (`hidden={row.removed}`, `checked={row.done}`,
`title={row.error}`), a class name inside object form
(`class={{ completed: row.done }}`), the whole `class`/`style`
(`class={row.rowClass}`), a style property (`style={{ opacity: row.fade }}`),
an event (`onInput={row.onToggle}`), a ref (`ref={row.ref}`) — on an element
with a spread too (`<button {...rest} onClick={row.go} />` — the last
source that has the key wins, `undefined` included, as the client's
spread reads it) — and a text child (`<strong>{list.remaining}</strong> items
left`): a string or number renders, nullish and booleans render empty, and
the client owns the text between a `<!--_s:t=…-->` marker pair. Never the
content of `<textarea>`, `<title>`, `<style>` or `<script>`, where the
markers would be literal text — bind `value=` or a style property there.
Not a `prop:*` property, not inside another slot call's args (nested in
plain objects and arrays included). Reserved keys the fill must not use:
keys beginning with `$` or a digit, `length`, `slice`, `t`/`h`/`p`, `then`,
`constructor`/`toString`/`valueOf`/`toJSON`; anything else (`filter`, `map`
included) is a plain property.

The server **does not have the value** — on the stream face a property read
is a stand-in with no value, on the document face only the initial one — so
nothing can be computed from it on the server. Every one of these is wrong:

| Wrong                                                                  | Why                                                                                   | Write instead                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ``class={`todo ${row.done}`}``                                         | stringified: not the whole value                                                      | `class={{ todo: true, completed: row.done }}` or return `rowClass` from the fill                 |
| `row.count > 3 ? "a" : "b"`                                            | comparison on a stand-in                                                              | decide in the fill; return the decided value                                                     |
| `if (row.error) …`, `row.error && <button/>`, `<Show when={row.done}>` | truthiness: a stand-in is an object and **always truthy** — the branch always renders | presence → `hidden={…}` or a class; a node that exists because of client state → a template slot |
| `<strong>{row.label}</strong>` where the fill returns JSX for `label`  | a text position renders a string or number                                            | a template slot for markup                                                                       |
| `<textarea>{row.draft}</textarea>`                                     | raw-text content: the markers land in the text                                        | `value={row.draft}`                                                                              |
| `format(row.title)` (a server helper)                                  | the helper receives a stand-in                                                        | do the formatting in the fill                                                                    |
| `<li {...row}>`                                                        | spread: the template must show what the client owns                                   | name each position                                                                               |
| `onClick={() => …}` on a server element                                | a server function can never run in the browser                                        | bind a slot property or a form `action`                                                          |
| `onKeyDown={[row.key, 1]}`                                             | a tuple: a marker names keys, never data                                              | return `onKeyDown: [handler, data]` from the fill; bind `onKeyDown={row.onKeyDown}`              |

Every case except truthiness and raw-text content is a dev finding
(`BINDING_SLOT_POSITION`) and renders **nothing on either face**, so it
shows on the first render. Truthiness has no runtime hook: if a retry button
appears on every row, this is why. Raw-text content has none either; in
`<textarea>` and `<title>` the markers show as text.

## Writing the fill

- **The fill runs once per occurrence, as a component body does.** It runs
  untracked, under the occurrence's owner, with live args. State it
  creates (a signal, a memo, an `onCleanup`) lives as long as the
  occurrence. A top-level read is read once, and `STRICT_READ_UNTRACKED`
  names it.
- **Values as getters, handlers as plain closures.** A getter is the
  reactive form, as on a component's props object; a plain value never
  updates:

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

  Each getter is read where its position binds, so a change moves the
  positions that read it. The same object serves a client
  `<TodoRow row={rowFor(todo)} />`, whose body reads it the same way. A
  plain value is right only for what never changes (a constant handler,
  a fixed class).

- **Name it like a props interface**, because it is one (a shared component
  takes it as a prop). Handlers are `on` + intent — `onToggle`, `onRemove`,
  `onCopy`, `onClearCompleted`; the position names the DOM event, the key
  names the meaning, as a component's `onSelect` does. Values are nouns or
  adjectives (`done`, `rowClass`, `error`, `busy`); a ref is `ref`. The
  runtime reads nothing into the prefix — the position decides what a
  property is — but a reader can tell a handler from a value without
  opening the type.
- Handlers and refs are read once, when an element binds, and bind as in
  client JSX: delegated events delegate, a `[handler, data]` tuple returned
  from the fill binds as a tuple, a ref fires once per element. A handler
  behind a getter is read once, as `onClick={cond() ? a : b}` is.
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
the binding slot's return, on the client it is the fill's result. It
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

`BINDING_SLOT_POSITION` (`data.reason`):

| reason         | severity       | what happened                                                                                                                                   | fix                                                                                                                                                               |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spread`       | error (throws) | a slot's return was spread onto an element                                                                                                      | name each position                                                                                                                                                |
| `stringified`  | warn           | template literal / concatenation                                                                                                                | whole value at one position                                                                                                                                       |
| `coerced`      | warn           | comparison, arithmetic, `==`                                                                                                                    | decide in the fill                                                                                                                                                |
| `inline`       | warn           | reached `class`/`style` inside template quotes                                                                                                  | compile with `serverComponents: true`                                                                                                                             |
| `markup`       | warn           | the fill returned JSX but the template read a property                                                                                          | return an object, or place the slot                                                                                                                               |
| `server-local` | warn           | a server function at `on*`/`ref`                                                                                                                | bind a slot property                                                                                                                                              |
| `tuple`        | warn           | an array at an `on*` position                                                                                                                   | return the tuple from the fill                                                                                                                                    |
| `reserved-key` | warn           | the fill used a reserved key                                                                                                                    | rename it                                                                                                                                                         |
| `arg`          | warn           | a slot property passed in another slot call's argument (nested in plain objects/arrays; `data.path`)                                            | pass the server's own value, or read it in the fill from client state                                                                                             |
| `prop`         | warn           | a slot property at a `prop:*` key of a spread                                                                                                   | bind the attribute form, or set the property in the fill's ref                                                                                                    |
| `fill-shape`   | warn (client)  | the fill returned a non-object (`null`, array, DOM node, async value, primitive), or the prop read as data is not a function                    | return a plain object from a function prop                                                                                                                        |
| `text-shape`   | warn (client)  | a text position received a non-primitive (object, array, DOM node, function, async value — `data.key`, `data.shape`)                            | return a string or number; markup goes in a template slot                                                                                                         |
| `orphan`       | warn (client)  | markers for an occurrence that can never bind: `data.why` `"fill"` — no fill for the prop; `"record"` — a called occurrence with no args record | `fill`: pass the prop / match the name on both sides. `record`: not the fill — rebuild client and server together (stale prebundle, cached asset), else report it |

Every reason but `fill-shape`, `text-shape` and `orphan` comes from the server render.
`orphan` is the one failure this model cannot otherwise show you: the
element is inert — a handler that never fires, a class that never updates —
with no error.

`STRICT_READ_UNTRACKED` naming a fill ("the \`row\` binding-slot fill",
"the \`comment\` template-slot fill"): a top-level read in its body; use
getters (above).
