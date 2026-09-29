// The todo store, server-only: this module is only imported by "use server"
// modules, so unstorage never reaches the client build. It is the SPA twin's
// mock API (../../../todos/src/api.ts) moved behind the server boundary with
// the same shape and the same deliberate unreliability: every save waits
// 400 ms and ~33% of them fail, so the optimistic UI, the per-item errors
// and the retry affordances get exercised. Todos reset on server restart
// (memory driver); swap the driver for a durable store in a deployment.
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const storage = createStorage({ driver: memoryDriver() });

const SEED: Todo[] = [
  { id: "0001", title: "Read the server-components principles", completed: true },
  { id: "0002", title: "Port TodoMVC to a server component", completed: false },
  { id: "0003", title: "Break the network and watch it recover", completed: false }
];

export async function getTodos(): Promise<Todo[]> {
  const todos = (await storage.getItem("todos")) as Todo[] | null;
  if (todos) return todos;
  await storage.setItem("todos", SEED);
  return SEED;
}

async function saveTodos(todos: Todo[]) {
  if (Math.random() < 0.33) return reject(400);
  await storage.setItem("todos", todos);
  return delay(undefined, 400);
}

export async function addTodo(todo: Todo) {
  const newTodo = { ...todo };
  const todos = await getTodos();
  if (todos.some(t => t.id === newTodo.id)) return newTodo;
  const index = todos.findIndex(t => t.id > newTodo.id);
  if (index > -1) todos.splice(index, 0, newTodo);
  else todos.push(newTodo);
  await saveTodos(todos);
  return newTodo;
}

export async function removeTodo(todoId: string) {
  return saveTodos((await getTodos()).filter(t => t.id !== todoId));
}

export async function toggleTodo(todoId: string, completed: boolean) {
  let found: Todo | undefined;
  const todos = (await getTodos()).map(t => {
    if (t.id !== todoId) return t;
    return (found = { ...t, completed });
  });
  if (!found) return reject(400);
  await saveTodos(todos);
  return found;
}

export async function toggleAll(ids: string[], completed: boolean) {
  const set = new Set(ids);
  const todos = (await getTodos()).map(t => (set.has(t.id) ? { ...t, completed } : t));
  return saveTodos(todos);
}

export async function clearCompleted(ids: string[]) {
  const set = new Set(ids);
  return saveTodos((await getTodos()).filter(t => !set.has(t.id)));
}

function delay<T>(payload: T, time: number) {
  return new Promise<T>(res => setTimeout(res, time, payload));
}

function reject(time: number) {
  return new Promise<never>((_, rej) => setTimeout(rej, time, new Error("Failed to save")));
}
