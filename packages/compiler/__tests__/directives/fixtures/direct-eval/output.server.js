import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const inspect = function inspect(expr) {
	return eval(expr);
};
import { db } from "./db";
const serverFunction_1 = registerServerReference_1("b5494e4b-0", async (q) => {
	return db.query(q);
});
export const run = createServerReference_1(serverFunction_1);
export { inspect };
