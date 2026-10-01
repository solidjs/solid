# Todos — TodoMVC as a Solid Server Component

The [../todos](../todos) example, with the list moved to the server. The
list is one `"use server"` query that returns a component
([src/todo-list.tsx](./src/todo-list.tsx)); it arrives as HTML, and every
control in it is a form that posts a mutation. Nothing in the list needs
JavaScript to work.

What JavaScript adds is the optimism a form cannot give — and some it
cannot express at all. A toggle shows its result before the server answers;
toggle-all checks every row, clear-completed hides them, and "N items left"
counts through both. The client binds those values onto the server's own
elements through **binding slots**, and reads the server's answers —
including its failures — through `useSubmissions`.

Same deliberately unreliable store as the SPA (400 ms saves, ~33% of them
fail), so the optimistic UI, the per-row errors and the retry affordances
get exercised.

```sh
pnpm dev                  # http://localhost:3010
pnpm build && pnpm start  # http://localhost:3010
```

## Forms first

Each mutation is a router `action` around a `"use server"` function
([src/actions.ts](./src/actions.ts)). The list renders them as forms; a row
binds its id with `.with()`, and the button carries the value it submits:

```tsx
<form action={toggleTodo.with(t.id)} method="post">
  <button class="toggle" name="completed" value={row.toggleTo} aria-pressed={row.pressed} />
</form>
```

Without JavaScript the browser posts, the server redirects back, and the
page renders the stored state. With it, the router submits the same form
through the action, and the response is **single-flight**
([src/server-config.ts](./src/server-config.ts)): the POST reruns the
page's preload, so one round trip carries the mutation's result and the
list's fresh markup.

## Errors are answers

A failed save returns `{ error }` rather than throwing, so the failure is
typed from the store ([src/server/db.ts](./src/server/db.ts)) to the
client. The router records it as a submission; `useSubmissions(action)`
lists them, and `submission.retry()` runs the same call again. Each
action's `onSettled` clears the earlier answers to the same question, so a
success dismisses an old error and a new failure takes its place. After a
no-JavaScript post the router seeds the same list from its flash cookie, so
the error renders on the server too.

Adding is not optimistic: the server has not rendered a row for a todo it
has not stored. The header ([src/app.tsx](./src/app.tsx)) marks the form
busy while the add is in flight, clears the input on success, and keeps
the text with the error and a retry on failure.

## Binding slots

A slot the server calls returns **bindings**: an object whose properties
the server template reads at positions — an attribute, a class, a handler,
a text child. The list calls `props.row(...)` once per todo and
`props.list(...)` once, with the data the client needs to decide:

```tsx
const row = props.row({ $key: t.id, id: t.id, completed: t.completed, filter });

<li $key={t.id} class={row.rowClass} hidden={row.hidden}>
```

One rule: a slot property is a JSX attribute value, whole, or a text
child, and nothing else. `class={row.rowClass}` binds;
``class={`todo ${row.rowClass}`}`` or `if (row.hidden)` in the server
component does not — the server has no value to compute with, so the
decision belongs in the fill, which returns the decided value.

The client's **fills** ([src/routes/todos.tsx](./src/routes/todos.tsx))
receive the args as reactive props and return the object. A fill runs once
per occurrence, as a component body does, so values are getters and
handlers are plain closures. On the server each read marks its position;
at document render the fill runs inline, so the document already carries
`class="todo completed"` and `aria-pressed="true"` before JavaScript, and
on hydration the fill binds to the same nodes. A response morphing the
list keeps the positions a fill owns.

## What the client holds

The SPA kept the todo array on the client. This app never has it — the
rows are markup. What it holds is **intent**: what it has asked the server
to do and not yet seen land, in a `createOptimisticStore`. Each action's
`onSubmit` writes it inside the action's transition, so it releases in the
frame the response's markup lands — a success shows no seam, a failure
shows the server's value again.

- toggle: the row shows `intent[id].completed ?? completed`, and under a
  filter the row hides as soon as it no longer matches
- remove: `hidden` on the server's `<li>` until the response drops the row
- toggle-all and clear-completed: the list's fill writes intent for every
  row it was given — the cross-element optimism no single form can express
- the count, the toggle-all state and the clear button: the list's fill
  computes them from its rows and the intent
