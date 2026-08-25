import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { buildConfig } from "./config";
export const config = buildConfig();
const serverFunction_1 = registerServerReference_1("d1f836b4-0", async event => {
  return fetch(config.endpoint, {
    method: "POST",
    body: event
  });
});
export const push = createServerReference_1(serverFunction_1);
