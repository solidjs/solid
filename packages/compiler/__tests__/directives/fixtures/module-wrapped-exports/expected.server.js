import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const saveUserImpl = async function saveUserImpl(user) {
  await saveToDb(user);
  return user;
};
import { withValidation, withDelay } from "./wrappers.js";
import { userSchema } from "./schema.js";
import { saveToDb } from "./db.js";
const serverFunction_1 = registerServerReference_1("getUser-64795c56", withValidation(userSchema, async id => {
  return {
    id: id
  };
}));
export const getUser = createServerReference_1(serverFunction_1);
const serverFunction_2 = registerServerReference_1("impl-64795c56", withDelay(saveUserImpl, 400));
const impl = createServerReference_1(serverFunction_2);
const alias = impl;
export { alias as saveUser };
const serverFunction_3 = registerServerReference_1("plain-64795c56", async () => "plain");
export const plain = createServerReference_1(serverFunction_3);
const serverFunction_4 = registerServerReference_1("defaultExport_1-64795c56", withDelay(async () => "mocked", 400));
const defaultExport_1 = createServerReference_1(serverFunction_4);
export default defaultExport_1;
