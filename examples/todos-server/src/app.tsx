// The client side. Compare with ../../todos/src/app.tsx: `Header` and
// `TodoRow` are the same client components — `TodoRow` is shared with the
// server (./todo-row.tsx). `MainSection` and `Footer` are gone: that markup
// comes from the server component (server/todos.tsx) as HTML, and the
// client's part of it is one FILL per data context — `rowFor` for a row,
// `listFor` for the list — a function of the server's args (and the
// client's intent, errors and filter) returning the values the server
// template binds. The server rows read those through an attribute slot; the
// pending rows (todos the server has not seen) are the only client markup,
// and they are `TodoRow` again, handed the same fill's result directly.
import { createContext, Errored, For, Loading, useContext } from "solid-js";
import { dynamic } from "@solidjs/web";
import { createTodos, type Todos as TodosState } from "./todos";
import { createHashFilter, type Filter } from "./filter";
import { TodoRow, type RowBehavior } from "./todo-row";
import type { Entity } from "./server/todos";
import "./app.css";

const TodosContext = createContext<TodosState>();

function Header() {
  const { actions } = useContext(TodosContext);
  return (
    <header class="header">
      <h1>todos</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          const title = e.currentTarget.value.trim();
          if (!title) return;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          actions.addTodo({ id, title, completed: false });
          e.currentTarget.value = "";
        }}
      />
    </header>
  );
}

function TodoList(props: { filter: Filter }) {
  const state = useContext(TodosContext);
  const { intent, errors, done, removed, extraRows, counts, actions } = state;
  const Todos = dynamic(() => state.todos());

  const visible = (completed: boolean) =>
    props.filter === "all" || (props.filter === "active") !== completed;

  // A row's behavior, from the server's view of it (`completed` as of the
  // last response) and the client's (intent over it, errors beside it).
  // Same function for a server row (through the `row` attribute slot) and a
  // pending one (passed to <TodoRow> directly). Values are getters and
  // handlers are plain closures: building the object reads nothing, so the
  // reads happen where the template binds each property — a tracking scope
  // for a value, event time for a handler — and each position updates on
  // its own.
  const rowFor = (p: Entity): RowBehavior => ({
    get rowClass() {
      return {
        todo: true,
        completed: done(p.id, p.completed),
        pending: !!intent.byId[p.id] || intent.adds.some(t => t.id === p.id),
        errored: !!errors[p.id]
      };
    },
    get done() {
      return done(p.id, p.completed);
    },
    get removed() {
      return removed(p.id) || !visible(done(p.id, p.completed));
    },
    get error() {
      return errors[p.id] ? `Retry ${errors[p.id]!.type}` : undefined;
    },
    onToggle: e => actions.toggleTodo(p.id, e.currentTarget.checked),
    onRemove: () => actions.removeTodo(p.id, p.completed),
    onRetry: () => actions.retryTodo(p.id)
  });

  // The ids whose client-side `completed` is the given value, from the
  // server's two lists (an entity's intent may have moved it across).
  const idsWhere = (p: { active: string[]; completed: string[] }, completed: boolean) => [
    ...p.active.filter(id => !removed(id) && done(id, false) === completed),
    ...p.completed.filter(id => !removed(id) && done(id, true) === completed)
  ];
  const listFor = (p: { total: number; active: string[]; completed: string[] }) => {
    const active = () => idsWhere(p, false);
    const completed = () => idsWhere(p, true);
    const allDone = () => active().length === 0 && completed().length > 0;
    return {
      get empty() {
        return counts({ remaining: 0, total: p.total }).total === 0;
      },
      get allDone() {
        return allDone();
      },
      get noneDone() {
        return completed().length === 0;
      },
      onToggleAll: () =>
        allDone() ? actions.toggleAll(completed(), false) : actions.toggleAll(active(), true),
      onClearCompleted: () => actions.clearCompleted(completed())
    };
  };

  return (
    <Todos
      list={listFor}
      row={rowFor}
      pending={() => (
        <For each={extraRows()}>
          {todo => <TodoRow id={todo.id} title={todo.title} row={rowFor(todo)} />}
        </For>
      )}
      count={p => {
        const remaining = () => counts(p).remaining;
        return (
          <>
            <strong>{remaining()}</strong> {remaining() === 1 ? "item" : "items"} left
          </>
        );
      }}
      filters={() => ({
        all: props.filter === "all",
        active: props.filter === "active",
        completed: props.filter === "completed"
      })}
    />
  );
}

export default function App() {
  const filter = createHashFilter();
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="app-error">
          <p>Something went wrong: {String(err())}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <TodosContext value={createTodos()}>
        <section class="todoapp">
          <Header />
          <Loading fallback={<p class="loading">Loading…</p>}>
            <TodoList filter={filter()} />
          </Loading>
        </section>
      </TodosContext>
    </Errored>
  );
}
