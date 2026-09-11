import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { track } from "./analytics";
const serverFunction_1 = registerServerReference_1("handlers.save-32e00052", function saveRecord(data) {
  return track("save", data);
}, "handlers.save");
const serverFunction_2 = registerServerReference_1("handlers.drop-32e00052", function (id) {
  return track("drop", id);
}, "handlers.drop");
export const handlers = {
  save: createServerReference_1(serverFunction_1),
  drop: createServerReference_1(serverFunction_2)
};
