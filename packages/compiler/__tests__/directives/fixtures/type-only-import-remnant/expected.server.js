import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { type Session, verify } from "./server-module";
import { type Meta, mixedValue, helper } from "./mixed-module";
export const value = mixedValue;
const serverFunction_1 = registerServerReference_1("31e1639f-0", async (): Promise<Session | null> => {
  return verify(helper());
});
export const serverAction = createServerReference_1(serverFunction_1);
