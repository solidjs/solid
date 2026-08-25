import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { logError } from "./log";
// Module-level try/catch orphaned by the rewrite: the declarator inside the
// try goes (its only read lived in the replaced body), the try/catch itself
// and its catch binding stay (Babel never removes catch clauses).
try {} catch (error) {
	logError(error);
}
export const save = createServerReference_1("9774c758-0");
export const keep = () => true;
