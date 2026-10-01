// The client's half of the list. Compare with ../../../todos/src/todos.ts:
// the SPA keeps the todo array and layers optimistic writes and errors over
// it. Here the array is server markup the client never holds. What it holds
// is INTENT — what it has asked the server to do and not yet seen land —
// and it reads the server's answers where the router keeps them.
//
//   Optimistic  `intent`, written in each action's `onSubmit`, inside the
//               action's transition: it releases in the frame the
//               response's markup lands, so a success shows no seam and a
//               failure shows the server's value again.
//   Answers     `useSubmissions(action)`: a failed save's `{ error }`, kept
//               until the next attempt at the same thing settles. The same
//               list is seeded from the flash cookie when a form posted
//               without JavaScript, so the errors render on the server too.
//   Truth       the fills' args: the server's rows as of the last response.
//
// The fills are the only place the three meet, and each runs once per
// occurrence, as a component body does: values are getters over the args
// and the stores, handlers are plain closures.
import { useSubmissions, type RouteProps, type Submission } from "@solidjs/router";
import { createOptimisticStore } from "solid-js";
import { dynamic } from "@solidjs/web";
import { clearCompleted, completedOf, removeTodo, toggleAll, toggleTodo } from "~/actions";
import {
  getTodoList,
  parseFilter,
  type ListArgs,
  type ListBindings,
  type RowArgs,
  type RowBindings
} from "~/todo-list";

type Intent = { completed?: boolean; removed?: boolean };
type Answer = Submission<any[], { error: string } | undefined>;

const failedFor = (subs: Answer[], id: string) =>
  subs.find(s => s.input[0] === id && s.result?.error);

/** A settled attempt replaces the earlier answers to the same question: a
 *  success (which records nothing) dismisses an old error, a new failure
 *  takes its place. */
const supersede =
  (subs: Answer[], same: (a: Answer, b: Answer) => boolean = () => true) =>
  (settled: Answer) => {
    for (const s of [...subs]) if (s !== settled && same(s, settled)) s.clear();
  };
const sameRow = (a: Answer, b: Answer) => a.input[0] === b.input[0];

export default function Todos(props: RouteProps<"/">) {
  const List = dynamic(() => getTodoList(parseFilter(props.location.query.filter)));

  const [intent, setIntent] = createOptimisticStore<Record<string, Intent>>({});
  const want = (s: Record<string, Intent>, id: string, change: Intent) => {
    s[id] = { ...s[id], ...change };
  };
  const done = (id: string, completed: boolean) => intent[id]?.completed ?? completed;

  const toggles = useSubmissions(toggleTodo) as Answer[];
  const removals = useSubmissions(removeTodo) as Answer[];
  const bulk = {
    "Couldn't mark all": useSubmissions(toggleAll) as Answer[],
    "Couldn't clear completed": useSubmissions(clearCompleted) as Answer[]
  };

  toggleTodo
    .onSubmit((id, form) => setIntent(s => want(s, id, { completed: completedOf(form) })))
    .onSettled(supersede(toggles, sameRow));
  removeTodo
    .onSubmit(id => setIntent(s => want(s, id, { removed: true })))
    .onSettled(supersede(removals, sameRow));
  // The list shows one bulk outcome: the latest, whichever action it was.
  for (const subs of Object.values(bulk)) {
    toggleAll.onSettled(supersede(subs));
    clearCompleted.onSettled(supersede(subs));
  }

  const rowFor = (p: RowArgs): RowBindings => {
    const pending = () => intent[p.id] !== undefined;
    const failure = () =>
      pending() ? undefined : (failedFor(removals, p.id) ?? failedFor(toggles, p.id));
    const shown = () => done(p.id, p.completed);
    return {
      get rowClass() {
        return { todo: true, completed: shown(), pending: pending(), errored: !!failure() };
      },
      get hidden() {
        return (
          !!intent[p.id]?.removed || (p.filter !== "all" && shown() !== (p.filter === "completed"))
        );
      },
      get pressed() {
        return shown() ? "true" : "false";
      },
      get toggleTo() {
        return shown() ? "false" : "true";
      },
      get error() {
        const f = failure();
        return f && `${f.result!.error} — click to retry`;
      },
      onRetry: () => failure()?.retry()
    };
  };

  const listFor = (p: ListArgs): ListBindings => {
    // The optimism no single form can express: one click, every row. It
    // lives here because the list's args are the rows it applies to.
    toggleAll.onSubmit(form =>
      setIntent(s => {
        for (const t of p.todos) want(s, t.id, { completed: completedOf(form) });
      })
    );
    clearCompleted.onSubmit(() =>
      setIntent(s => {
        for (const t of p.todos)
          if (s[t.id]?.completed ?? t.completed) want(s, t.id, { removed: true });
      })
    );

    const live = () => p.todos.filter(t => !intent[t.id]?.removed);
    const remaining = () => live().filter(t => !done(t.id, t.completed)).length;
    const allDone = () => live().length > 0 && remaining() === 0;
    const failure = () => {
      for (const [label, subs] of Object.entries(bulk)) {
        const s = subs.find(s => s.result?.error);
        if (s) return { label, s };
      }
    };
    return {
      get empty() {
        return live().length === 0;
      },
      get allDone() {
        return allDone() ? "true" : "false";
      },
      get toggleAllTo() {
        return allDone() ? "false" : "true";
      },
      get noneDone() {
        return remaining() === live().length;
      },
      get remaining() {
        return remaining();
      },
      get itemsLeft() {
        return remaining() === 1 ? "item left" : "items left";
      },
      get noError() {
        return !failure();
      },
      get error() {
        const f = failure();
        return f && `${f.label}: ${f.s.result!.error}.`;
      },
      onRetry: () => failure()?.s.retry()
    };
  };

  return <List row={rowFor} list={listFor} />;
}
