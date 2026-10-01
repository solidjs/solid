// TodoMVC's list as a server component. Compare with the SPA twin's app.tsx:
// the markup is the same, the rows are server data (titles, ids, the stored
// `completed`), and every control is a form that posts a mutation. Nothing
// here needs JavaScript to work.
//
// What JavaScript adds is optimism the browser cannot give on its own: a
// click that shows its result before the server answers, and — the part a
// form cannot express at all — clicks that change OTHER elements: toggle-all
// checks every row, clear-completed hides them, and "N items left" counts
// through both. The client owns those values and binds them onto these
// elements through BINDING SLOTS: `props.row(...)` and `props.list(...)` are
// called with the element's data and read as objects, their properties
// bound at positions — an attribute, a class, a handler, a text child. The
// server writes each position's first value in the document and never
// branches on one (a stand-in is always truthy); a response morphing this
// list keeps the positions the client owns.
import { query } from "@solidjs/router";
import type { BindingSlot } from "@solidjs/web/frames";
import { clearCompleted, removeTodo, toggleAll, toggleTodo } from "~/actions";
import * as db from "~/server/db";

export type Filter = "all" | "active" | "completed";

export const parseFilter = (value: unknown): Filter =>
  value === "active" || value === "completed" ? value : "all";

/** What a row's fill is called with: the row as the server has it. */
export type RowArgs = { id: string; completed: boolean; filter: Filter };

/** What the client decides about a row. */
export interface RowBindings {
  rowClass: Record<string, boolean>;
  hidden: boolean;
  pressed: "true" | "false";
  /** The `completed` value the row's toggle submits: the opposite of what it shows. */
  toggleTo: "true" | "false";
  error: string | undefined;
  onRetry: () => void;
}

/** What the list's fill is called with: every todo, before the filter. */
export type ListArgs = { todos: { id: string; completed: boolean }[] };

/** What the client decides about the list as a whole. */
export interface ListBindings {
  empty: boolean;
  allDone: "true" | "false";
  toggleAllTo: "true" | "false";
  noneDone: boolean;
  remaining: number;
  itemsLeft: string;
  noError: boolean;
  error: string | undefined;
  onRetry: () => void;
}

export interface TodoListProps {
  row: BindingSlot<RowArgs, RowBindings>;
  list: BindingSlot<ListArgs, ListBindings>;
}

// The filter is a query param the server applies, so a filtered page is
// right before JavaScript and a filter link is a navigation that refetches
// this component. The rows carry it in their args: a toggle under "Active"
// hides its row before the response takes it out.
export const getTodoList = query(async (filter: Filter) => {
  "use server";
  const todos = await db.getTodos();
  const shown = todos.filter(t => filter === "all" || t.completed === (filter === "completed"));

  return (props: TodoListProps) => {
    const list = props.list({ todos: todos.map(({ id, completed }) => ({ id, completed })) });
    return (
      <>
        <section class="main" hidden={list.empty}>
          <form action={toggleAll} method="post">
            <button
              class="toggle-all"
              name="completed"
              value={list.toggleAllTo}
              aria-pressed={list.allDone}
            >
              Mark all as complete
            </button>
          </form>
          <ul class="todo-list">
            {shown.map(t => {
              // `$key` on the call is the occurrence's identity, on the <li>
              // its morph identity: a response keeps both for the same todo.
              const row = props.row({ $key: t.id, id: t.id, completed: t.completed, filter });
              return (
                <li $key={t.id} class={row.rowClass} hidden={row.hidden}>
                  <div class="view">
                    <form action={toggleTodo.with(t.id)} method="post">
                      <button
                        class="toggle"
                        name="completed"
                        value={row.toggleTo}
                        aria-pressed={row.pressed}
                        aria-label={`Toggle ${t.title}`}
                      />
                    </form>
                    <label>{t.title}</label>
                    <button class="retry" title={row.error} onClick={row.onRetry} />
                    <form action={removeTodo.with(t.id)} method="post">
                      <button class="destroy" aria-label={`Delete ${t.title}`} />
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <footer class="footer" hidden={list.empty}>
          <span class="todo-count">
            <strong>{list.remaining}</strong> {list.itemsLeft}
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
          <form action={clearCompleted} method="post" hidden={list.noneDone}>
            <button class="clear-completed">Clear completed</button>
          </form>
        </footer>
        <p class="list-error" hidden={list.noError}>
          {list.error} <button onClick={list.onRetry}>Retry</button>
        </p>
      </>
    );
  };
}, "todos");
