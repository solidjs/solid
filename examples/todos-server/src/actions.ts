// The mutations. Each one is a form's action: the server component renders
// `<form action={toggleTodo.with(id)}>`, so every control works before
// JavaScript loads (a no-JS post redirects back with the outcome in a flash
// cookie), and after it the router submits the same form in place. The
// value a button submits is the intent — `completed=true` — rather than
// "flip", so two quick clicks each say what the user saw.
//
// None of them redirects: the response answers the page the form was posted
// from (see ../server-config.ts), so it carries the outcome AND the list's
// fresh markup in one round trip. A failed save answers `{ error }` rather
// than throwing, so the failure is typed where the client reads it; the
// server words it, because only the server knows the todo's title.
import { action } from "@solidjs/router";
import * as db from "~/server/db";

/** The `completed` a toggle form submitted: the button's value. */
export const completedOf = (form: FormData) => form.get("completed") === "true";

async function titleOf(id: string) {
  const todo = (await db.getTodos()).find(t => t.id === id);
  return todo ? `“${todo.title}”` : "a todo";
}

export const addTodo = action(async (form: FormData) => {
  "use server";
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "A todo needs a title" };
  return db.addTodo(title);
});

export const toggleTodo = action(async (id: string, form: FormData) => {
  "use server";
  const completed = completedOf(form);
  if (await db.toggleTodo(id, completed))
    return { error: `Couldn't ${completed ? "complete" : "reopen"} ${await titleOf(id)}` };
});

export const removeTodo = action(async (id: string) => {
  "use server";
  if (await db.removeTodo(id)) return { error: `Couldn't delete ${await titleOf(id)}` };
});

export const toggleAll = action(async (form: FormData) => {
  "use server";
  const completed = completedOf(form);
  if (await db.toggleAll(completed))
    return { error: `Couldn't mark everything ${completed ? "complete" : "active"}` };
});

export const clearCompleted = action(async () => {
  "use server";
  if (await db.clearCompleted()) return { error: "Couldn't clear completed" };
});
