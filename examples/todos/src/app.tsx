import { createContext, Errored, For, Loading, Show, useContext } from "solid-js";
import { createTodos, type Todo } from "./todos";
import { createHashFilter, type Filter } from "./filter";

const TodosContext = createContext<ReturnType<typeof createTodos>>();

function Header() {
  const [, { addTodo }] = useContext(TodosContext);
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
          addTodo({ id, title, completed: false });
          e.currentTarget.value = "";
        }}
      />
    </header>
  );
}

function TodoItem(props: { todo: Todo }) {
  const [, { toggleTodo, removeTodo, retryTodo }] = useContext(TodosContext);
  return (
    <li
      class={[
        "todo",
        {
          completed: props.todo.completed,
          pending: !!props.todo.pending,
          errored: !!props.todo.error
        }
      ]}
    >
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={props.todo.completed}
          onChange={() => toggleTodo(props.todo.id, !props.todo.completed)}
        />
        <label>{props.todo.title}</label>
        <Show when={props.todo.error}>
          {err => (
            <button
              class="retry"
              title={`Retry ${err().type}`}
              onClick={() => retryTodo(props.todo)}
            />
          )}
        </Show>
        <button class="destroy" onClick={() => removeTodo(props.todo.id)} />
      </div>
    </li>
  );
}

function MainSection(props: { filter: Filter }) {
  const [todos, { toggleAll }] = useContext(TodosContext);
  const filtered = () => {
    const f = props.filter;
    if (f === "active") return todos.filter(x => !x.completed);
    if (f === "completed") return todos.filter(x => x.completed);
    return todos;
  };
  const allCompleted = () => todos.length > 0 && todos.every(x => x.completed);
  return (
    <Show when={todos.length > 0}>
      <section class="main">
        <input
          id="toggle-all"
          class="toggle-all"
          type="checkbox"
          checked={allCompleted()}
          onChange={() => toggleAll(!allCompleted())}
        />
        <label for="toggle-all">Mark all as complete</label>
        <ul class="todo-list">
          <For each={filtered()}>{todo => <TodoItem todo={todo()} />}</For>
        </ul>
      </section>
    </Show>
  );
}

function Footer(props: { filter: Filter }) {
  const [todos, { clearCompleted }] = useContext(TodosContext);
  const remaining = () => todos.filter(x => !x.completed).length;
  const completed = () => todos.length - remaining();
  return (
    <Show when={todos.length > 0}>
      <footer class="footer">
        <span class="todo-count">
          <strong>{remaining()}</strong> {remaining() === 1 ? "item" : "items"} left
        </span>
        <ul class="filters">
          <li>
            <a href="#/" class={{ selected: props.filter === "all" }}>
              All
            </a>
          </li>
          <li>
            <a href="#/active" class={{ selected: props.filter === "active" }}>
              Active
            </a>
          </li>
          <li>
            <a href="#/completed" class={{ selected: props.filter === "completed" }}>
              Completed
            </a>
          </li>
        </ul>
        <Show when={completed() > 0}>
          <button class="clear-completed" onClick={() => clearCompleted()}>
            Clear completed
          </button>
        </Show>
      </footer>
    </Show>
  );
}

export function App() {
  const filter = createHashFilter();
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="app-error">
          <p>Something went wrong: {String(err)}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <TodosContext value={createTodos()}>
        <section class="todoapp">
          <Header />
          <Loading fallback={<p class="loading">Loading…</p>}>
            <MainSection filter={filter()} />
            <Footer filter={filter()} />
          </Loading>
        </section>
      </TodosContext>
    </Errored>
  );
}
