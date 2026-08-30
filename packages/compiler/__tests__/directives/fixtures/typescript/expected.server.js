import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_2 = registerServerReference_1("touch-1db3b5f2", function touch(id: string) {
  db.users.touch(id);
});
const touch = createServerReference_1(serverFunction_2);
import { db } from "./db";
const serverFunction_1 = registerServerReference_1("findUser-1db3b5f2", async (id: string): Promise<unknown> => {
  return db.users.find(id);
});
export const findUser = createServerReference_1(serverFunction_1);
export { touch };
