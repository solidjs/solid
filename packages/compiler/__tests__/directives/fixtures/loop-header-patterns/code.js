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

export const summarize = async () => {
  "use server";
  return meta.version + cursor.id;
};

export const keep = () => names;
