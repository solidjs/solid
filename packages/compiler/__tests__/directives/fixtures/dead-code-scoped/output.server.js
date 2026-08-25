import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { startTimer } from "./metrics";
import { connect } from "./db";
// Pre-existing dead code: written for its side effect, never referenced.
const t = startTimer();
const URL = "postgres://localhost";
const conn = connect(URL);
const serverFunction_1 = registerServerReference_1("5835907-0", async (data) => {
	return conn.insert(data);
});
export const save = createServerReference_1(serverFunction_1);
