import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_1 = registerServerReference_1("d0bb28bc-0", async function getUser(id) {
	return db.users.find(id);
});
const getUser = createServerReference_1(serverFunction_1);
import { db } from "./db";
export { getUser };
const serverFunction_2 = registerServerReference_1("d0bb28bc-1", async (id) => {
	await db.users.delete(id);
});
export const deleteUser = createServerReference_1(serverFunction_2);
const serverFunction_3 = registerServerReference_1("d0bb28bc-2", async () => db.raw());
const impl = createServerReference_1(serverFunction_3);
export { impl as runQuery };
export default getUser;
