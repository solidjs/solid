// The client shell: the header and the boundary the list renders in. The
// list itself is a server component (./todo-list.tsx) and its client half
// is the route (./routes/todos.tsx).
//
// Adding shows intent like every other form: the router marks it
// `aria-busy` while it saves (app.css dims the input), the input clears when
// the answer lands, and a failure stays in the input with its error beside
// it.
import { useSubmissions } from "@solidjs/router";
import { Errored, Loading, Show } from "solid-js";
import { addTodo } from "~/actions";
import { Router } from "~/router";
import "./app.css";

function Header() {
  let input!: HTMLInputElement;
  const adds = useSubmissions(addTodo);
  const failure = () => adds.find(s => s.result?.error);
  addTodo.onSettled(settled => {
    for (const s of [...adds]) if (s !== settled) s.clear();
    if (!settled.result) input.value = "";
  });
  return (
    <header class="header">
      <h1>todos</h1>
      <form action={addTodo} method="post">
        <input
          ref={input}
          class="new-todo"
          name="title"
          placeholder="What needs to be done?"
          autocomplete="off"
          autofocus
          required
        />
      </form>
      <Show when={failure()}>
        {f => (
          <p class="add-error">
            Couldn't add “{String(f().input[0].get("title"))}”: {f().result!.error}.{" "}
            <button onClick={() => f().retry()}>Retry</button>
          </p>
        )}
      </Show>
    </header>
  );
}

export default function App() {
  return (
    <Router>
      {props => (
        <Errored
          fallback={(err, reset) => (
            <div class="app-error">
              <p>Something went wrong: {String(err())}</p>
              <button onClick={reset}>Reset</button>
            </div>
          )}
        >
          <section class="todoapp">
            <Header />
            <Loading fallback={<p class="loading">Loading…</p>}>{props.children}</Loading>
          </section>
        </Errored>
      )}
    </Router>
  );
}
