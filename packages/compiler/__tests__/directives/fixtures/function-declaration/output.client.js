import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
const todoActions = function todoActions() {
	return saveTodo;
};
const saveTodo = createServerReference_1("saveTodo-f0017999");
export { saveTodo };
export { todoActions };
