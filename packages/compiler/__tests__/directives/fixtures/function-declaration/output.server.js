import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const todoActions = function todoActions() {
  return saveTodo;
};
const serverFunction_1 = registerServerReference_1("f0017999-0", async function saveTodo(todo) {
  return db.todos.insert(todo);
});
const saveTodo = createServerReference_1(serverFunction_1);
import { db } from "./db";
export { saveTodo };
export { todoActions };
