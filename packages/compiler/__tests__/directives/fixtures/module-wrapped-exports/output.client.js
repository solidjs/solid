import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { GET, withMeta, wrap } from "./wrappers";
const cache = true;
const metadata = { cache };
const fn_1 = withMeta(GET(createServerReference_1("64795c56-0")), metadata), fn_2 = wrap(createServerReference_1("64795c56-1"));
export { fn_1 as "getUser", fn_2 as "saveUser" };
