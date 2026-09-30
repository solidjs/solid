// The client's half of the list. Compare with ../../todos/src/todos.ts: the
// SPA keeps the whole todo array on the client and layers optimistic writes
// and errors over it. Here the array is server markup that the client never
// holds — what it holds is INTENT (what it has asked the server to do and
// not yet heard back about) and the errors it heard back. Both are keyed by
// entity id, and the fills in app.tsx combine them with the args each server
// element carries.
//
// Same three lifetime layers as the SPA, same order, without the array:
//
//   3. Optimistic  (transition-scoped) ── `intent`, a `createOptimisticStore`
//                                         written inside `action` generators;
//                                         auto-reverts when the action settles,
//                                         which is when the server's answer
//                                         has APPLIED (see the actions).
//   2. Ephemeral   (UI-scoped)         ── `errors`, a plain store written after
//                                         the call fails. Survives the revert
//                                         because it is not optimistic.
//   1. Persistent  (durable)           ── the server's rows: `p.completed` in
//                                         a fill's props is truth as of the
//                                         last response.
//
// Every fill reads (3) over (1) and shows (2) beside it.
//
// Pending rows are not inert (parity with the SPA): a toggle or remove on a
// todo whose add is still in flight writes its intent immediately and then
// waits for the add to settle before talking to the server — the server
// has no such id until then. A todo whose add FAILED exists only here, so
// those actions edit the failed record instead (the retry carries the
// change).

import { action, createMemo, createOptimisticStore, createStore, refresh } from "solid-js";
import type { Todo } from "~/lib/db";
import * as server from "~/server/todos";

export type { Todo };

export type TodoError = {
  type: "addTodo" | "removeTodo" | "toggleTodo";
  args: any[];
};

export interface Intent {
  /** The server's `completed` when the intent was written (for the counts). */
  from: boolean;
  completed?: boolean;
  removed?: boolean;
}

export function createTodos() {
  // The source the boundary shows and the actions refetch. `refresh(todos)`
  // re-runs the memo, which re-calls the server component; the transaction
  // holds until the refetched markup and args have applied.
  const todos = createMemo(() => server.todoListView());

  const [intent, setIntent] = createOptimisticStore<{
    byId: Record<string, Intent>;
    adds: Todo[];
  }>({ byId: {}, adds: [] });

  const [errors, setErrors] = createStore<Record<string, TodoError | undefined>>({});

  /** Adds in flight, by id: what a toggle/remove on a pending row waits on. */
  const inflight = new Map<string, Promise<void>>();
  /** The failed add a todo exists in, if that is the only place it exists. */
  const failedAdd = (id: string) => (errors[id]?.type === "addTodo" ? errors[id] : undefined);

  /** The client's view of one entity's `completed`: intent over the server. */
  const done = (id: string, completed: boolean) => intent.byId[id]?.completed ?? completed;
  const removed = (id: string) => !!intent.byId[id]?.removed;

  /** Todos the server does not have: in-flight adds, then adds that failed.
   *  The store's own objects, not copies: their identity is stable across
   *  reads, so a `<For>` over them keeps each row's node while the list
   *  around it changes. */
  const extraRows = (): Todo[] => {
    const rows: Todo[] = [...intent.adds];
    for (const id in errors) {
      const error = errors[id];
      if (error?.type === "addTodo" && !rows.some(r => r.id === id)) rows.push(error.args[0]);
    }
    return rows.sort((a, b) => (a.id > b.id ? 1 : -1));
  };

  /** Counts as the client sees them: the server's, adjusted by intent. */
  const counts = (p: { remaining: number; total: number }) => {
    let remaining = p.remaining;
    let total = p.total;
    const extra = extraRows();
    for (const id in intent.byId) {
      // Intent over a row the server has; a pending row's intent is read
      // with the row below.
      if (extra.some(t => t.id === id)) continue;
      const i = intent.byId[id];
      if (i.removed) {
        total--;
        if (!i.from) remaining--;
      } else if (i.completed !== undefined && i.completed !== i.from) {
        remaining += i.completed ? -1 : 1;
      }
    }
    for (const t of extra) {
      if (removed(t.id)) continue;
      total++;
      if (!done(t.id, t.completed)) remaining++;
    }
    return { remaining, total };
  };

  function fail(id: string, error: TodoError) {
    setErrors(e => {
      e[id] ||= error;
    });
  }
  function ok(id: string) {
    setErrors(e => {
      delete e[id];
    });
  }

  const add = action(function* (todo: Todo) {
    setIntent(s => {
      if (!s.adds.some(t => t.id === todo.id)) s.adds.push(todo);
    });
    try {
      yield server.addTodo(todo);
      ok(todo.id);
    } catch {
      fail(todo.id, { type: "addTodo", args: [todo] });
    }
    yield refresh(todos);
  });

  const actions = {
    addTodo(todo: Todo): Promise<void> {
      const p = add(todo).finally(() => {
        if (inflight.get(todo.id) === p) inflight.delete(todo.id);
      });
      inflight.set(todo.id, p);
      return p;
    },
    removeTodo: action(function* (id: string, completed: boolean) {
      setIntent(s => {
        s.byId[id] = { from: completed, removed: true };
      });
      // Sequenced behind the add the server has not answered yet.
      const pending = inflight.get(id);
      if (pending) yield pending;
      if (failedAdd(id)) {
        // The todo never reached the server: removing it is forgetting it.
        ok(id);
        return;
      }
      try {
        yield server.removeTodo(id);
        ok(id);
      } catch {
        fail(id, { type: "removeTodo", args: [id, completed] });
      }
      yield refresh(todos);
    }),
    toggleTodo: action(function* (id: string, completed: boolean) {
      setIntent(s => {
        s.byId[id] = { from: !completed, completed };
      });
      const pending = inflight.get(id);
      if (pending) yield pending;
      const failed = failedAdd(id);
      if (failed) {
        // The todo exists only in its failed add: the retry adds it toggled.
        setErrors(e => {
          (e[id]!.args[0] as Todo).completed = completed;
        });
        return;
      }
      try {
        yield server.toggleTodo(id, completed);
        ok(id);
      } catch {
        fail(id, { type: "toggleTodo", args: [id, completed] });
      }
      yield refresh(todos);
    }),
    toggleAll: action(function* (ids: string[], completed: boolean) {
      setIntent(s => {
        for (const id of ids) s.byId[id] = { from: !completed, completed };
      });
      try {
        yield server.toggleAll(ids, completed);
        ids.forEach(ok);
      } catch {
        // Bulk failed — fan the error out to per-item entries so each
        // failed item gets its own retry affordance via `retryTodo`.
        ids.forEach(id => fail(id, { type: "toggleTodo", args: [id, completed] }));
      }
      yield refresh(todos);
    }),
    clearCompleted: action(function* (ids: string[]) {
      setIntent(s => {
        for (const id of ids) s.byId[id] = { from: true, removed: true };
      });
      try {
        yield server.clearCompleted(ids);
        ids.forEach(ok);
      } catch {
        ids.forEach(id => fail(id, { type: "removeTodo", args: [id, true] }));
      }
      yield refresh(todos);
    }),
    retryTodo(id: string): Promise<void> {
      const error = errors[id];
      if (!error) return Promise.resolve();
      return (actions[error.type] as (...args: any[]) => Promise<void>)(...error.args);
    }
  };

  return { todos, intent, errors, done, removed, extraRows, counts, actions };
}

export type Todos = ReturnType<typeof createTodos>;
