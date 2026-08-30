import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { getTriple, getList } from "./data";
const [, second] = getTriple();
const [head] = getList();
export const send = createServerReference_1("send-70d95093", "send");
export const keep = () => second;
