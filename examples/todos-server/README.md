# Todos — TodoMVC as a Solid Server Component

The [../todos](../todos) example, with the list moved to the server. The
list is one `"use server"` query that returns a component
([src/todo-list.tsx](./src/todo-list.tsx)); it arrives as HTML, and every
control in it is a form that posts a mutation. Nothing in the list needs
JavaScript to work, and none of it is client code.

What JavaScript adds is **instant intent**: the moment you click, the page
shows what you asked for — a toggle presses down, a deleted row dims — and
the server's answer replaces it. It never shows a guess at the answer. The
SPA twin predicts outcomes (a toggle checks itself, the count moves before
the server agrees); this app shows the request, and lets the server say
what happened.

Same deliberately unreliable store as the SPA (400 ms saves, ~33% of them
fail), so the in-flight marks, the failures and the retries get exercised.

```sh
pnpm dev                  # http://localhost:3010
pnpm build && pnpm start  # http://localhost:3010
```

## Forms first

Each mutation is a router `action` around a `"use server"` function
([src/actions.ts](./src/actions.ts)). The list renders them as forms; a row
binds its id with `.with()`, and the button carries the value it submits:

```tsx
<form class="toggle-form" action={toggleTodo.with(t.id)} method="post">
  <button class="toggle" name="completed" value={t.completed ? "false" : "true"} />
</form>
```

Without JavaScript the browser posts, the server redirects back, and the
page renders the stored state. With it, the router submits the same form
through the action, and the response is **single-flight**
([src/server-config.ts](./src/server-config.ts)): the POST reruns the
page's preload, so one round trip carries the mutation's result and the
list's fresh markup.

## Intent is CSS

While a form's submission is in flight, the router marks it `aria-busy`.
That attribute is all [src/app.css](./src/app.css) needs:

```css
.todo-list li:has(.toggle-form[aria-busy]) label { /* this row: asked */ }
.todoapp:has(.toggle-all-form[aria-busy]) .todo-list li label { /* every row: asked */ }
.todo-list li:has(.destroy-form[aria-busy]) { /* dims */ }
.todoapp:has(.clear-completed-form[aria-busy]) .todo-list li.completed { /* dims */ }
```

`:has()` is what carries toggle-all and clear-completed to every row they
touch — the cross-element feedback a single form can't express on its own.
A mark that waits more than two seconds starts to pulse. Each mark belongs
to its own submission, so overlapping requests don't clear each other's.

## Errors are answers

A failed save returns `{ error }` rather than throwing, so the failure is
typed from the action to the client. The server words it — it knows the
todo's title, the client doesn't. The router records each submission;
`useSubmissions(action)` lists them, and `submission.retry()` runs the same
call again. The route ([src/routes/todos.tsx](./src/routes/todos.tsx))
renders the failures under the list — the one piece of client code the list
has — and each action's `onSettled` clears the earlier answers to the same
question, so a success dismisses an old error and a new failure takes its
place. After a no-JavaScript post the router seeds the same list from its
flash cookie, so the failures render on the server too.

Adding works the same way: the header ([src/app.tsx](./src/app.tsx)) marks
the input busy while the add is in flight, clears it on success, and keeps
the text with the error and a retry on failure.

## Prediction, when you want it

Instant intent covers most interactions without client state. When an app
should show the outcome before the server agrees — the SPA twin's
behaviour — render that piece as a client component, where an optimistic
store and ordinary JSX can predict it.
