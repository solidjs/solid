import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
import { rows, meta, cursor, seed } from "./db";
// Destructured loop-header bindings orphaned by the rewrite (SolidStart's
// server-function-unused-destructure e2e family): the `meta` element and the
// `cursor` init declarator only shadow names the replaced body referenced,
// so the client shake prunes them (and the imports they stranded) while the
// loops keep iterating.
const names = [];
for (const { meta, name } of rows) {
	names.push(name);
}
for (let index = 0, cursor = seed(); index < names.length; index++) {
	names.push(index);
}
const serverFunction_1 = registerServerReference_1("a02335a-0", async () => {
	return meta.version + cursor.id;
});
export const summarize = createServerReference_1(serverFunction_1);
export const keep = () => names;
