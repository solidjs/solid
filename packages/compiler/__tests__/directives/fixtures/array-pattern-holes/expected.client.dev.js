import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { getTriple, getList } from "./data";
const [, second] = getTriple();
const [head] = getList();
export const send = createServerReference_1("70d95093-0-send", "send");
export const keep = () => second;
