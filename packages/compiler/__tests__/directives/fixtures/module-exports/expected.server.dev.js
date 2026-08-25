import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_1 = registerServerReference_1("d0bb28bc-0-getUser", async function getUser(id) {
  return db.users.find(id);
}, "getUser");
const getUser = createServerReference_1(serverFunction_1);
import { db } from "./db";
export { getUser };
const serverFunction_2 = registerServerReference_1("d0bb28bc-1-deleteUser", async id => {
  await db.users.delete(id);
}, "deleteUser");
export const deleteUser = createServerReference_1(serverFunction_2);
const serverFunction_3 = registerServerReference_1("d0bb28bc-2-impl", async () => db.raw(), "impl");
const impl = createServerReference_1(serverFunction_3);
export { impl as runQuery };
export default getUser;
