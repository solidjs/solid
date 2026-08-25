import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_1 = registerServerReference_1("cb5f8b97-0", () => {
  return 1;
});
const helper = function helper() {
  const inner = createServerReference_1(serverFunction_1);
  return inner;
};
const serverFunction_2 = registerServerReference_1("cb5f8b97-1", async () => {
  return helper();
});
export const run = createServerReference_1(serverFunction_2);
