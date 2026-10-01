// The mutations. Each one is a form's action: the server component renders
// `<form action={toggleTodo.with(id)}>`, so every control works before
// JavaScript loads (a no-JS post redirects back with the outcome in a flash
// cookie), and after it the router submits the same form in place. The
// value a button submits is the intent — `completed=true` — rather than
// "flip", so two quick clicks each say what the user saw.
//
// None of them redirects: the response answers the page the form was posted
// from (see ../server-config.ts), so it carries the outcome AND the list's
// fresh markup in one round trip, and the optimistic writes release in the
// same frame the new markup lands. A failed save answers `{ error }` rather
// than throwing, so the failure is typed where the client reads it.
import { action } from "@solidjs/router";
import * as db from "~/server/db";

/** The `completed` a toggle form submitted: the button's value. */
export const completedOf = (form: FormData) => form.get("completed") === "true";

export const addTodo = action(async (form: FormData) => {
  "use server";
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "A todo needs a title" };
  return db.addTodo(title);
});

export const toggleTodo = action(async (id: string, form: FormData) => {
  "use server";
  return db.toggleTodo(id, completedOf(form));
});

export const removeTodo = action(async (id: string) => {
  "use server";
  return db.removeTodo(id);
});

export const toggleAll = action(async (form: FormData) => {
  "use server";
  return db.toggleAll(completedOf(form));
});

export const clearCompleted = action(async () => {
  "use server";
  return db.clearCompleted();
});
