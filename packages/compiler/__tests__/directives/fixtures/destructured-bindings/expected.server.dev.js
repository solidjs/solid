import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { createClient } from "./db";
import { loadConfig } from "./config";
const {
  db: db
} = createClient(loadConfig());
const {
  site: site,
  secret: secret
} = loadConfig();
const serverFunction_1 = registerServerReference_1("2bfb27d5-0-remove", async id => {
  await db.delete(id, secret);
}, "remove");
export const remove = createServerReference_1(serverFunction_1);
export const title = site.name;
