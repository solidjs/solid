import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { GET, withMeta, wrap, serverOnly } from "./wrappers";
import { db } from "./db";
const cache = true;
const metadata = { cache };
const serverFunction_1 = registerServerReference_1("64795c56-0", async (id) => db.users.find(id));
export const getUser = withMeta(GET(createServerReference_1(serverFunction_1)), metadata);
const serverFunction_2 = registerServerReference_1("64795c56-1", async function saveUser(user) {
	return db.users.save(user);
});
const save = wrap(createServerReference_1(serverFunction_2));
export { save as saveUser };
