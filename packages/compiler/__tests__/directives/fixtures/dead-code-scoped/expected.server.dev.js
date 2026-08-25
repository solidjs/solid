import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { startTimer } from "./metrics";
import { connect } from "./db";
const t = startTimer();
const URL = "postgres://localhost";
const conn = connect(URL);
const serverFunction_1 = registerServerReference_1("5835907-0-save", async data => {
  return conn.insert(data);
}, "save");
export const save = createServerReference_1(serverFunction_1);
