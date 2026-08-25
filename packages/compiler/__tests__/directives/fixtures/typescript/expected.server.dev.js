import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_2 = registerServerReference_1("1db3b5f2-1-touch", function touch(id: string) {
  db.users.touch(id);
}, "touch");
const touch = createServerReference_1(serverFunction_2);
import { db } from "./db";
const serverFunction_1 = registerServerReference_1("1db3b5f2-0-findUser", async (id: string): Promise<unknown> => {
  return db.users.find(id);
}, "findUser");
export const findUser = createServerReference_1(serverFunction_1);
export { touch };
