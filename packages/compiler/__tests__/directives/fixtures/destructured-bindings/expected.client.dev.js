import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { loadConfig } from "./config";
const {
  site: site
} = loadConfig();
export const remove = createServerReference_1("remove-2bfb27d5", "remove");
export const title = site.name;
