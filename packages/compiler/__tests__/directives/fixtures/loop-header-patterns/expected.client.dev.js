import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { rows } from "./db";
const names = [];
for (const {
  name: name
} of rows) {
  names.push(name);
}
for (let index = 0; index < names.length; index++) {
  names.push(index);
}
export const summarize = createServerReference_1("a02335a-0-summarize", "summarize");
export const keep = () => names;
