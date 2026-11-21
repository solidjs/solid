import { it } from "vitest";
import { $TARGET } from "../../src/store/types.js";
import { $THIN } from "../../src/store/thin.js";

/** A store's internal record on either engine (spike): both keep value
 * nodes on `n`, presence on `h`, structure on `k`, the raw on `v`. */
export const targetOf = (proxy: any): any => proxy?.[$TARGET] ?? proxy?.[$THIN];

/** A test of a deep-engine mechanism with no thin counterpart (the
 * committed backing, its overlay and rebuild, the key count, the owner
 * stamp, `storeLookup`): skipped while the thin engine runs (spike). */
export const deepOnly: typeof it = ((globalThis as any).THIN_STORE ? it.skip : it) as any;
