import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { rows, meta } from "./db";
const count = [];
for (const {
  meta: meta
} of rows) {
  count.push(1);
}
const serverFunction_1 = registerServerReference_1("4691ef5d-0-version", async () => {
  return meta.version;
}, "version");
export const version = createServerReference_1(serverFunction_1);
export const keep = () => count.length;
