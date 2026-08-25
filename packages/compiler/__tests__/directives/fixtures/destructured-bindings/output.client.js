import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { loadConfig } from "./config";
const { site } = loadConfig();
export const remove = createServerReference_1("2bfb27d5-0");
export const title = site.name;
