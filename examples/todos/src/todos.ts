// If you came here to enumerate React-vs-Solid syntax differences, you've
// already misread this example. The thing that matters is what ~170 lines
// accomplishes — fetch + per-item optimistic writes + per-item errors +
// retry + bulk operations + loading + transitions, with the layering
// enforced by primitive composition rather than by convention. That, not
// the symbol diff, is what's distinctive.
//
// State architecture: three lifetime layers, each a derivation of the layer
// below, applied in a fixed order across the whole application.
//
//   3. Optimistic  (transition-scoped) ── `setTodos` writes inside `action`
//                                         generators, auto-revert on settle.
//                                         Layered on top of (2).
//   2. Ephemeral   (UI-scoped)         ── the `Errors` side-channel below,
//                                         applied inside the projection fn
//                                         on top of (1). Survives optimistic
//                                         revert because it lives *under* the
//                                         optimistic overlay, not in it. Same
//                                         tier covers success toasts, drafts,
//                                         modal state, etc.
//   1. Persistent  (durable)           ── `api.getTodos()` inside the
//                                         projection fn. Server here; could
//                                         equally be localStorage / IndexedDB
//                                         / URL — the framework doesn't care.
//
// Consumers read the topmost layer (`todos`). The ordering isn't a choice —
// the primitive composition enforces it: the projection runs (1)→(2), and
// `createOptimisticStore` wraps that with (3). Splitting the layers into
// separate stores (a `createStore` projection + a `createProjection` overlay
// + an outer `createOptimisticStore`) is possible and gives each layer its
// own identity, but exposes intermediate views as accidental footguns; the
// single-primitive form is canonical.

import { action, createOptimisticStore, refresh } from "solid-js";
import { api, type Todo as ServerTodo } from "./api";

export type TodoError = {
  type: "addTodo" | "removeTodo" | "toggleTodo";
  args: any[];
};

export interface Todo extends ServerTodo {
  pending?: boolean;
  error?: TodoError;
}

// Side-channel of action failures, keyed by todo id. Plain (non-reactive)
// JS map — read only inside the projection function, which re-runs on
// `refresh(todos)`. Mutations followed by `refresh(todos)` are what make
// errors visible; nothing else observes this object directly.
const Errors: Record<string, TodoError> = {};

function applyErrors(todos: Todo[], errors: Record<string, TodoError>) {
  for (const key in errors) {
    const error = errors[key];
    switch (error.type) {
      case "addTodo": {
        // Server doesn't have this todo (the add failed). Reinsert it locally
        // in id-sorted position with `error` set so it shows in the list.
        const newTodo: Todo = { ...error.args[0], error };
        const index = todos.findIndex(t => t.id > newTodo.id);
        if (index > -1) todos.splice(index, 0, newTodo);
        else todos.push(newTodo);
        break;
      }
      case "removeTodo":
      case "toggleTodo": {
        const todo = todos.find(t => t.id === error.args[0]);
        if (todo) todo.error = error;
        break;
      }
    }
  }
}

export interface TodoActions {
  addTodo: (todo: ServerTodo) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
  toggleTodo: (id: string, completed: boolean) => Promise<void>;
  toggleAll: (completed: boolean) => Promise<void>;
  clearCompleted: () => Promise<void>;
  retryTodo: (todo: Todo) => Promise<void>;
}

export function createTodos() {
  const [todos, setTodos] = createOptimisticStore<Todo[]>(async () => {
    const todos: Todo[] = await api.getTodos();
    applyErrors(todos, Errors);
    return todos;
  }, []);

  const actions = {
    addTodo: action(function* (todo: ServerTodo) {
      setTodos(t => {
        const old = t.find(x => x.id === todo.id);
        if (old) old.pending = true;
        else t.push({ ...todo, pending: true });
      });
      try {
        yield api.addTodo(todo);
        delete Errors[todo.id];
      } catch {
        Errors[todo.id] ||= { type: "addTodo", args: [todo] };
      }
      refresh(todos);
    }),
    removeTodo: action(function* (id: string) {
      setTodos(t => t.filter(todo => todo.id !== id));
      try {
        yield api.removeTodo(id);
        delete Errors[id];
      } catch {
        Errors[id] ||= { type: "removeTodo", args: [id] };
      }
      refresh(todos);
    }),
    toggleTodo: action(function* (id: string, completed: boolean) {
      setTodos(t => {
        const todo = t.find(x => x.id === id);
        if (todo) {
          todo.completed = completed;
          todo.pending = true;
        }
      });
      try {
        yield api.toggleTodo(id, completed);
        delete Errors[id];
      } catch {
        Errors[id] ||= { type: "toggleTodo", args: [id, completed] };
      }
      refresh(todos);
    }),
    toggleAll: action(function* (completed: boolean) {
      const ids = todos.filter(t => t.completed !== completed).map(t => t.id);
      const set = new Set(ids);
      setTodos(t => {
        t.forEach(todo => {
          if (set.has(todo.id)) {
            todo.completed = completed;
            todo.pending = true;
          }
        });
      });
      try {
        yield api.toggleAll(ids, completed);
        ids.forEach(id => delete Errors[id]);
      } catch {
        // Bulk failed — fan the error out to per-item entries so each
        // failed item gets its own retry affordance via `retryTodo`.
        ids.forEach(id => {
          Errors[id] ||= { type: "toggleTodo", args: [id, completed] };
        });
      }
      refresh(todos);
    }),
    clearCompleted: action(function* () {
      const ids = todos.filter(t => t.completed).map(t => t.id);
      setTodos(t => t.filter(todo => !todo.completed));
      try {
        yield api.clearCompleted(ids);
        ids.forEach(id => delete Errors[id]);
      } catch {
        ids.forEach(id => {
          Errors[id] ||= { type: "removeTodo", args: [id] };
        });
      }
      refresh(todos);
    }),
    retryTodo(todo: Todo): Promise<void> {
      if (!todo.error) return Promise.resolve();
      return (actions[todo.error.type] as any)(...todo.error.args);
    }
  };

  return [todos, actions] as const;
}
