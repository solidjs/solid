import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
const inspect = function inspect(expr) {
  return eval(expr);
};
import { db } from "./db";
export const run = createServerReference_1("run-b5494e4b", "run");
export { inspect };
