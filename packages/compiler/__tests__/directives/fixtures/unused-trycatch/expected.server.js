import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { connect } from "./db";
import { logError } from "./log";
try {
  var conn = connect();
} catch (error) {
  logError(error);
}
const serverFunction_1 = registerServerReference_1("9774c758-0", async data => {
  try {
    return conn.save(data);
  } catch (error) {
    return false;
  }
});
export const save = createServerReference_1(serverFunction_1);
export const keep = () => true;
