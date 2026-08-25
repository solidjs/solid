import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { register } from "./bus";
const serverFunction_1 = registerServerReference_1("3a0ab4b1-0-anonymous", async event => {
  return event.type;
});
register(createServerReference_1(serverFunction_1));
