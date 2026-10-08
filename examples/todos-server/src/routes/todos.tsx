// The route: the server's list, and the one thing about it the server cannot
// render — answers to requests this browser made. Compare with
// ../../../todos/src/todos.ts: the SPA keeps the todo array and layers
// optimistic writes and errors over it. Here the array is server markup the
// client never holds, and there is no optimistic layer: intent shows from
// `aria-busy` and CSS (see ../todo-list.tsx), so the client keeps only the
// failures, where the router already keeps them.
//
// `useSubmissions(action)` lists a failed save's `{ error }` until the next
// attempt at the same thing settles. After a form posted without JavaScript
// the router seeds the same list from its flash cookie, so the failures
// render on the server too.
import { useSubmissions, type RouteProps, type Submission } from "@solidjs/router";
import { For } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import { clearCompleted, removeTodo, toggleAll, toggleTodo } from "~/actions";
import { getTodoList, parseFilter } from "~/todo-list";

type Answer = Submission<any[], { error: string } | undefined>;

/** A settled attempt replaces the earlier answers to the same question: a
 *  success (which records nothing) dismisses an old error, a new failure
 *  takes its place. Row actions ask about one todo; bulk ones about all. */
const supersede =
  (subs: Answer[], sameTodo = false) =>
  (settled: Answer) => {
    for (const s of [...subs])
      if (s !== settled && (!sameTodo || s.input[0] === settled.input[0])) s.clear();
  };

function Failures() {
  const toggles = useSubmissions(toggleTodo) as Answer[];
  const removals = useSubmissions(removeTodo) as Answer[];
  const markAll = useSubmissions(toggleAll) as Answer[];
  const clears = useSubmissions(clearCompleted) as Answer[];
  toggleTodo.onSettled(supersede(toggles, true));
  // A todo deleted has no open questions left, and marking all answers
  // every row's toggle.
  removeTodo.onSettled(settled => {
    supersede(removals, true)(settled);
    if (!settled.result) supersede(toggles, true)(settled);
  });
  toggleAll.onSettled(settled => {
    supersede(markAll)(settled);
    if (!settled.result) supersede(toggles)(settled);
  });
  clearCompleted.onSettled(supersede(clears));

  const failed = () =>
    [...toggles, ...removals, ...markAll, ...clears].filter(s => s.result?.error);
  return (
    <ul class="failures" hidden={failed().length === 0}>
      <For each={failed()}>
        {s => (
          <li>
            {s.result!.error}. <button onClick={() => s.retry()}>Retry</button>
          </li>
        )}
      </For>
    </ul>
  );
}

export default function Todos(props: RouteProps<"/">) {
  const List = dynamicComponent(() => getTodoList(parseFilter(props.location.query.filter)));
  return (
    <>
      <List />
      <Failures />
    </>
  );
}
