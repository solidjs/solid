"use server";
// TodoMVC's list as a server component. Compare with the SPA twin's
// app.tsx: the markup is the same, but this side renders DATA only — titles,
// counts, ids, the server's `completed` — and never a pending row, an error
// class or a retry button. Those belong to the client, and the client puts
// them on the server's own elements through ATTRIBUTE SLOTS: a slot CALLED with
// the element's data context and READ as an object, its properties bound
// at positions of the template. The fill on the other side receives the
// args as reactive props and returns the values; the runtime writes each
// bound position, re-runs the fill when the args change (a refetch) or the
// client's state does (an optimistic write), and morphs around the
// positions so a new response never clobbers a client-owned value.
//
// One call per data context: `props.row(entity)` is the row's whole client
// behavior, consumed by the row's <li>, its checkbox and its buttons
// (../todo-row.tsx); `props.list(...)` is the list-level behavior consumed
// by the section, the toggle-all box, the footer and the clear button.
//
// The one thing the client cannot bind is a row the server has not
// rendered — an optimistic add — so `<props.pending />` is a pre-placed
// MARKUP slot where the client renders its in-flight rows: the same
// `TodoRow`, with the same fill's result passed directly.
import type { AttributeSlot, Slot } from "@solidjs/web/frames";
import * as db from "~/lib/db";
import { TodoRow, type RowBehavior } from "~/todo-row";

export type Entity = { id: string; completed: boolean };

/** The list-level values and behavior the client owns. */
export interface ListBehavior {
  empty: boolean;
  allDone: boolean;
  onToggleAll: () => void;
  noneDone: boolean;
  onClearCompleted: () => void;
}

/** Which filter link is selected — client state (the URL hash). */
export interface FilterBehavior {
  all: boolean;
  active: boolean;
  completed: boolean;
}

export interface TodoListProps {
  list: AttributeSlot<{ total: number; active: string[]; completed: string[] }, ListBehavior>;
  row: AttributeSlot<Entity, RowBehavior>;
  pending: Slot;
  count: Slot<{ remaining: number; total: number }>;
  filters: AttributeSlot<{}, FilterBehavior>;
}

export async function todoListView() {
  const todos = await db.getTodos();
  const active = todos.filter(t => !t.completed).map(t => t.id);
  const completed = todos.filter(t => t.completed).map(t => t.id);
  return (props: TodoListProps) => {
    const list = props.list({ total: todos.length, active, completed });
    const filters = props.filters();
    return (
      <>
        <section class="main" hidden={list.empty}>
          <input
            id="toggle-all"
            class="toggle-all"
            type="checkbox"
            checked={list.allDone}
            onChange={list.onToggleAll}
          />
          <label for="toggle-all">Mark all as complete</label>
          <ul class="todo-list">
            {todos.map(t => (
              <TodoRow
                id={t.id}
                title={t.title}
                row={props.row({ $key: t.id, id: t.id, completed: t.completed })}
              />
            ))}
            <props.pending />
          </ul>
        </section>
        <footer class="footer" hidden={list.empty}>
          <span class="todo-count">
            <props.count remaining={active.length} total={todos.length} />
          </span>
          <ul class="filters">
            <li>
              <a href="#/" class={{ selected: filters.all }}>
                All
              </a>
            </li>
            <li>
              <a href="#/active" class={{ selected: filters.active }}>
                Active
              </a>
            </li>
            <li>
              <a href="#/completed" class={{ selected: filters.completed }}>
                Completed
              </a>
            </li>
          </ul>
          <button class="clear-completed" hidden={list.noneDone} onClick={list.onClearCompleted}>
            Clear completed
          </button>
        </footer>
      </>
    );
  };
}

// The mutations. Plain server functions: the client calls them from inside
// its actions and follows each with a refetch of `todoListView` (see
// ../todos.ts) — the "typical multi-flight" shape, where the write and the
// re-read are separate requests and the action's transaction spans both.
export async function addTodo(todo: db.Todo) {
  return db.addTodo(todo);
}
export async function removeTodo(id: string) {
  return db.removeTodo(id);
}
export async function toggleTodo(id: string, completed: boolean) {
  return db.toggleTodo(id, completed);
}
export async function toggleAll(ids: string[], completed: boolean) {
  return db.toggleAll(ids, completed);
}
export async function clearCompleted(ids: string[]) {
  return db.clearCompleted(ids);
}
