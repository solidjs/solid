import { rows, meta } from "./db";

// A for-of left pattern whose every element is rewrite-orphaned: the loop
// binding cannot be removed whole (the iteration must survive), so the
// pattern empties to `{}`. The client expected files here are hand-frozen —
// the Babel reference crashes on this shape (it tries to remove the whole
// `left`), so the native pass's valid output is the spec.
const count = [];
for (const { meta } of rows) {
  count.push(1);
}

export const version = async () => {
  "use server";
  return meta.version;
};

export const keep = () => count.length;
