# Todos — TodoMVC as a Solid Server Component

The [../todos](../todos) example, with the list moved to the server. The
markup that the SPA's `MainSection`, `TodoItem` and `Footer` produced is now
returned by one `"use server"` component and arrives as HTML; the browser
keeps the header, the optimistic state, and — the point of this example —
every behavior those components had, bound to the server's own elements
through **attribute slots**. The row is one component, `TodoRow`, that both
sides render.

Same deliberately unreliable API as the SPA (400 ms saves, ~33% of them
fail), so the optimistic UI, the per-item errors and the retry affordances
get exercised.

```sh
pnpm dev                  # http://localhost:3010
pnpm build && pnpm start  # http://localhost:3010
```

## Attribute slots

A slot renders one of two things: markup (placed as `<props.pending />`) or
**attribute values** — a plain object the server template consumes by
reading its properties at positions: an attribute, a class name, a style
property, a handler, a ref. The server component calls the slot once per
data context and reads from the result wherever it likes
([src/server/todos.tsx](./src/server/todos.tsx)):

```tsx
const list = props.list({ total, active, completed });
const filters = props.filters();

<section class="main" hidden={list.empty}>
  <input id="toggle-all" type="checkbox" checked={list.allDone} onChange={list.onToggleAll} />
  <ul class="todo-list">
    {todos.map(t => (
      <TodoRow id={t.id} title={t.title} row={props.row({ $key: t.id, id: t.id, completed: t.completed })} />
    ))}
    <props.pending />
  </ul>
</section>
<a href="#/" class={{ selected: filters.all }}>All</a>
```

`TodoRow` ([src/todo-row.tsx](./src/todo-row.tsx)) is the shared component:
it binds `row.rowClass`, `row.removed`, `row.done`, `row.onToggle`,
`row.onRemove`, `row.onRetry`, `row.error` at attribute, class, event and
handler positions and cannot tell — does not need to — whether `row` is an
attribute slot's value (server) or the fill's result passed directly (client).

The object is a props interface — `TodoRow` takes it as a prop on the client
path — so it is named like one: handlers are `on` + intent (`onToggle`,
`onRemove`; the position names the DOM event, the key names the meaning),
values are nouns (`done`, `rowClass`, `error`), a ref is `ref`. The
runtime reads nothing into the prefix — the position decides what a
property is — but a reader can tell a handler from a value without the type.

One rule: a slot property is a JSX attribute value, whole, and nothing else.
`class={row.rowClass}` binds; ``class={`todo ${row.rowClass}`}``,
`{row.title}` as text, or `if (row.done)` in the server component do not —
the server has no value to compute with, so the decision belongs in the
fill, which returns the decided value.

The client's fill receives the args as reactive props and returns the
**object** the template reads ([src/app.tsx](./src/app.tsx)):

```tsx
const rowFor = (p: Entity): RowBehavior => ({
  get rowClass() { return { todo: true, completed: done(p.id, p.completed), pending: …, errored: … }; },
  get done() { return done(p.id, p.completed); },
  get removed() { return removed(p.id) || !visible(done(p.id, p.completed)); },
  get error() { return errors[p.id] ? `Retry ${errors[p.id].type}` : undefined; },
  onToggle: e => actions.toggleTodo(p.id, e.currentTarget.checked),
  onRemove: () => actions.removeTodo(p.id, p.completed),
  onRetry: () => actions.retryTodo(p.id)
});

<Todos list={listFor} row={rowFor} filters={() => ({ all: filter === "all", … })} pending={…} count={…} />
```

The values are getters because the same `rowFor` result is a client
component's prop for the pending rows: a handler position (`onInput={props.row.onToggle}`)
is read once in the component body, and a getter-shaped object reads no
reactive state there. On the server each read at a position marks the
element (`_s:class="row#0001:rowClass"`, `_s:on:input="row#0001:onToggle"`);
the client binds exactly those positions, writes the values that change,
dispatches events to the current handler, and a response morphing the list
skips the positions a fill owns. At document SSR the fill runs inline, so
`checked` and `class="todo completed"` are in the HTML before JavaScript; on
hydration the fill binds to the same nodes.

## What the client holds

The SPA kept the todo array on the client. This app never has it — the rows
are markup. What it holds is **intent** (what it asked the server to do and
has not heard back about) in a `createOptimisticStore`, and the errors it
heard back in a plain store ([src/todos.ts](./src/todos.ts)). Fills combine
those with each call's args:

- toggle: `intent.byId[id]?.completed ?? p.completed`
- remove: `hidden` on the server's `<li>`; the morph drops the row when the
  refetch lands (or `hidden` reverts when the save fails)
- add: the one thing the client cannot decorate is a row the server has not
  rendered, so `<props.pending />` is a markup slot where the client renders
  in-flight and failed adds — as `TodoRow` again, with `rowFor(todo)`, so a
  pending row toggles and deletes like any other. Those actions wait for
  the add to settle before calling the server (it has no such id yet); a
  todo whose add failed lives only in its error record, so they edit that.
- counts, toggle-all, clear-completed, filters: the server passes its
  numbers and id lists as args; the fills adjust them by intent

## Mutation shape

Each action writes its intent, calls the server function, then
`yield refresh(todos)` — the "typical multi-flight" shape: the write and the
re-read are two requests, and the action's transaction spans both, so the
optimistic value holds until the refetched markup and args have applied.
(Under a router's single-flight mutations the fills are identical; only the
hold differs.)
