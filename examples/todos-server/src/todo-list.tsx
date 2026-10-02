// TodoMVC's list as a server component. Compare with the SPA twin's app.tsx:
// the markup is the same, but every value in it is the server's — titles,
// `completed`, the count, which buttons show — and every control is a form
// that posts a mutation. Nothing here needs JavaScript to work, and nothing
// here is client code: the list ships as HTML and its template never reaches
// the browser.
//
// What JavaScript adds is INSTANT INTENT, not prediction. While a form's
// submission is in flight the router marks it `aria-busy`, and app.css shows
// what was asked for from that alone: the clicked toggle presses down, a
// deleted row dims, and `:has()` carries toggle-all and clear-completed to
// every row they touch. Nothing on the client computes an outcome — the
// response's markup lands with the server's answer, and the marks go when
// the submission settles.
import { query } from "@solidjs/router";
import { clearCompleted, removeTodo, toggleAll, toggleTodo } from "~/actions";
import * as db from "~/server/db";

export type Filter = "all" | "active" | "completed";

export const parseFilter = (value: unknown): Filter =>
  value === "active" || value === "completed" ? value : "all";

// The filter is a query param the server applies, so a filtered page is
// right before JavaScript and a filter link is a navigation that refetches
// this component.
export const getTodoList = query(async (filter: Filter) => {
  "use server";
  const todos = await db.getTodos();
  const shown = todos.filter(t => filter === "all" || t.completed === (filter === "completed"));
  const remaining = todos.filter(t => !t.completed).length;
  const allDone = todos.length > 0 && remaining === 0;

  return () => (
    <>
      <section class="main" hidden={todos.length === 0}>
        <form class="toggle-all-form" action={toggleAll} method="post">
          <button
            class="toggle-all"
            name="completed"
            value={allDone ? "false" : "true"}
            aria-pressed={allDone ? "true" : "false"}
          >
            Mark all as complete
          </button>
        </form>
        <ul class="todo-list">
          {shown.map(t => (
            // `$key` is the row's morph identity: a response keeps the node
            // for the same todo.
            <li $key={t.id} class={{ todo: true, completed: t.completed }}>
              <div class="view">
                <form class="toggle-form" action={toggleTodo.with(t.id)} method="post">
                  <button
                    class="toggle"
                    name="completed"
                    value={t.completed ? "false" : "true"}
                    aria-pressed={t.completed ? "true" : "false"}
                    aria-label={`Toggle ${t.title}`}
                  />
                </form>
                <label>{t.title}</label>
                <form class="destroy-form" action={removeTodo.with(t.id)} method="post">
                  <button class="destroy" aria-label={`Delete ${t.title}`} />
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <footer class="footer" hidden={todos.length === 0}>
        <span class="todo-count">
          <strong>{remaining}</strong> {remaining === 1 ? "item left" : "items left"}
        </span>
        <ul class="filters">
          <li>
            <a href="/" class={{ selected: filter === "all" }}>
              All
            </a>
          </li>
          <li>
            <a href="/?filter=active" class={{ selected: filter === "active" }}>
              Active
            </a>
          </li>
          <li>
            <a href="/?filter=completed" class={{ selected: filter === "completed" }}>
              Completed
            </a>
          </li>
        </ul>
        <form
          class="clear-completed-form"
          action={clearCompleted}
          method="post"
          hidden={remaining === todos.length}
        >
          <button class="clear-completed">Clear completed</button>
        </form>
      </footer>
    </>
  );
}, "todos");
