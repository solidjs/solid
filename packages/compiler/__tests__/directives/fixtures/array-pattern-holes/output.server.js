import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { getTriple, getList } from "./data";
const [first, second, third] = getTriple();
const [head, ...tail] = getList();
const serverFunction_1 = registerServerReference_1("70d95093-0", async () => {
  return first + third + tail.length;
});
export const send = createServerReference_1(serverFunction_1);
export const keep = () => second;
