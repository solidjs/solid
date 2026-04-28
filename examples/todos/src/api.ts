// Mock TodoMVC API.
//
// Persists to `localStorage` and intentionally fails ~33% of saves so the
// per-todo error/retry affordances in `todos.ts` can be exercised. The
// 400 ms delays let `<Loading>` and the optimistic UI flicker visibly.

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

export const api = {
  getTodos() {
    return delay(getTodos(), 400);
  },
  async addTodo(todo: Todo) {
    const newTodo = { ...todo };
    const todos = getTodos();
    const index = todos.findIndex(t => t.id > newTodo.id);
    if (index > -1) todos.splice(index, 0, newTodo);
    else todos.push(newTodo);
    await saveTodos(todos);
    return newTodo;
  },
  async removeTodo(todoId: string) {
    return saveTodos(getTodos().filter(t => t.id !== todoId));
  },
  async toggleTodo(todoId: string, completed: boolean) {
    let found: Todo | undefined;
    const todos = getTodos().map(t => {
      if (t.id !== todoId) return t;
      return (found = { ...t, completed });
    });
    if (!found) return reject(400);
    await saveTodos(todos);
    return found;
  },
  async toggleAll(ids: string[], completed: boolean) {
    const set = new Set(ids);
    const todos = getTodos().map(t => (set.has(t.id) ? { ...t, completed } : t));
    return saveTodos(todos);
  },
  async clearCompleted(ids: string[]) {
    const set = new Set(ids);
    return saveTodos(getTodos().filter(t => !set.has(t.id)));
  }
};

function delay<T>(payload: T, time: number) {
  return new Promise<T>(res => setTimeout(res, time, payload));
}

function reject(time: number) {
  return new Promise((_, rej) => setTimeout(rej, time, "Failed to Save"));
}

function getTodos(): Todo[] {
  return JSON.parse(localStorage.getItem("TODOS") || "[]");
}

function saveTodos(todos: Todo[]) {
  if (Math.random() < 0.33) return reject(400);
  localStorage.setItem("TODOS", JSON.stringify(todos));
  return delay(undefined, 400);
}
