import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { rows } from "./db";
const count = [];
for (const {} of rows) {
  count.push(1);
}
export const version = createServerReference_1("4691ef5d-0-version", "version");
export const keep = () => count.length;
