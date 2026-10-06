// The realistic small app behind the `app: compiled …` scenarios: a todo
// list written as JSX and compiled by @solidjs/compiler at measure time
// (bundle.mjs), so the gate sees what the compiler emits and what
// @solidjs/web retains for it — none of which the hand-written `app:`
// fixtures reach (they call the runtime directly and never compile a
// template). Each construct is here because a real app has it:
//
// - templates with text holes, `value`/`checked` bindings and a `ref`;
// - the attribute runtime: an element spread (`<button {...rest}>`), `class`
//   objects (2.0's `classList`) and a `style` object;
// - delegated events (`onClick`, `onInput` — on elements, and through the
//   button's spread) and non-delegated ones (`onFocus`/`onBlur` — not in
//   the delegated set, so they are direct listeners);
// - `merge` / `omit` on props (2.0's `mergeProps` / `splitProps`) and a
//   component spread (`<TodoItem {...todo()}>`, which compiles to the
//   compiler's `mergeProps`);
// - a keyed `<For>`, `<Show>` with a function child, `<Loading>` around a
//   `lazy()` child (the lazy chunk is reported, not counted);
// - a store beside signals and memos.
//
// Shared by csr.jsx and hydrating.jsx; only the compile mode differs.
import { createMemo, createSignal, createStore, lazy, merge, omit } from "solid-js";

const Stats = lazy(() => import("./stats.jsx"));

// The design-system button: defaults merged under the caller's props, the
// component's own props split off, the rest spread onto the element.
function Button(props) {
  const merged = merge({ type: "button", variant: "default" }, props);
  const rest = omit(merged, "variant", "children");
  return (
    <button {...rest} class={{ btn: true, primary: merged.variant === "primary" }}>
      {merged.children}
    </button>
  );
}

function TodoItem(props) {
  return (
    <li class={{ todo: true, done: props.done }} style={{ opacity: props.done ? 0.6 : 1 }}>
      <input type="checkbox" checked={props.done} onInput={() => props.onToggle(props.id)} />
      <span>{props.title}</span>
      <Button variant="danger" aria-label="Remove" onClick={() => props.onRemove(props.id)}>
        ×
      </Button>
    </li>
  );
}

export default function App() {
  const [state, setState] = createStore({
    todos: [
      { id: 1, title: "Compile a template", done: true },
      { id: 2, title: "Measure it", done: false }
    ]
  });
  const [filter, setFilter] = createSignal("all");
  const [draft, setDraft] = createSignal("");
  const [focused, setFocused] = createSignal(false);
  const visible = createMemo(() =>
    filter() === "all" ? state.todos : state.todos.filter(t => t.done === (filter() === "done"))
  );
  const remaining = createMemo(() => state.todos.filter(t => !t.done).length);
  let input;
  let nextId = 3;

  const add = () => {
    const title = draft().trim();
    if (!title) return;
    setState(s => {
      s.todos.push({ id: nextId++, title, done: false });
    });
    setDraft("");
    input.focus();
  };
  const toggle = id =>
    setState(s => {
      const todo = s.todos.find(t => t.id === id);
      if (todo) todo.done = !todo.done;
    });
  const remove = id =>
    setState(s => {
      s.todos = s.todos.filter(t => t.id !== id);
    });
  const clearDone = () =>
    setState(s => {
      s.todos = s.todos.filter(t => !t.done);
    });

  return (
    <section class="app">
      <header class={{ focused: focused() }}>
        <h1>Todos</h1>
        <input
          ref={input}
          value={draft()}
          placeholder="What needs doing?"
          onInput={e => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <Button variant="primary" onClick={add} disabled={!draft().trim()}>
          Add
        </Button>
      </header>
      <ul>
        <For each={visible()} keyed={t => t.id} fallback={<li class="empty">Nothing here</li>}>
          {todo => <TodoItem {...todo()} onToggle={toggle} onRemove={remove} />}
        </For>
      </ul>
      <footer>
        <Show when={remaining()} fallback={<p>All done</p>}>
          {n => (
            <p>
              {n()} item{n() === 1 ? "" : "s"} left
            </p>
          )}
        </Show>
        <nav>
          <Button onClick={() => setFilter("all")}>All</Button>
          <Button onClick={() => setFilter("active")}>Active</Button>
          <Button onClick={() => setFilter("done")}>Done</Button>
          <button class="clear" onClick={clearDone} disabled={remaining() === state.todos.length}>
            Clear completed
          </button>
        </nav>
        <Loading fallback={<p>Loading stats…</p>}>
          <Stats todos={state.todos} />
        </Loading>
      </footer>
    </section>
  );
}
