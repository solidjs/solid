import "server-only";
// The todo store. Only `"use server"` bodies import it, and the client build
// replaces those with references, so unstorage never reaches the browser; the
// `server-only` marker fails the build if this module is ever imported from
// client code. It keeps the SPA twin's deliberate unreliability
// (../../../todos/src/api.ts): every save waits 400 ms and ~33% of them fail,
// so the optimistic UI, the per-row errors and the retry affordances get
// exercised. A failure is an answer, not an exception — the mutations return
// `{ error }`, which types the failure all the way to `useSubmissions` on the
// client. Todos reset on server restart (memory driver); swap the driver for
// a durable store in a deployment.
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

export type Failure = { error: string };

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

async function saveTodos(todos: Todo[]): Promise<Failure | undefined> {
  await new Promise(res => setTimeout(res, 400));
  if (Math.random() < 0.33) return { error: "Failed to save" };
  await storage.setItem("todos", todos);
}

export async function addTodo(title: string) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return saveTodos([...(await getTodos()), { id, title, completed: false }]);
}

export async function removeTodo(id: string) {
  return saveTodos((await getTodos()).filter(t => t.id !== id));
}

export async function toggleTodo(id: string, completed: boolean) {
  return saveTodos((await getTodos()).map(t => (t.id === id ? { ...t, completed } : t)));
}

export async function toggleAll(completed: boolean) {
  return saveTodos((await getTodos()).map(t => ({ ...t, completed })));
}

export async function clearCompleted() {
  return saveTodos((await getTodos()).filter(t => !t.completed));
}
