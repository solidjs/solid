import { db } from "./db";

export async function saveTodo(todo) {
  "use server";
  return db.todos.insert(todo);
}

export function todoActions() {
  return saveTodo;
}
