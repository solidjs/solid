import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { track } from "./analytics";
const serverFunction_1 = registerServerReference_1("32e00052-0-saveRecord", function saveRecord(data) {
  return track("save", data);
}, "saveRecord");
const serverFunction_2 = registerServerReference_1("32e00052-1-handlers", function (id) {
  return track("drop", id);
}, "handlers");
export const handlers = {
  save: createServerReference_1(serverFunction_1),
  drop: createServerReference_1(serverFunction_2)
};
