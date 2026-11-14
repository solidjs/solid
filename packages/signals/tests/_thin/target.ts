import { $TARGET } from "../../src/store/types.js";
import { $THIN } from "../../src/store/thin.js";

/** A store's internal record on either engine (spike): both keep value
 * nodes on `n`, presence on `h`, structure on `k`, the raw on `v`. */
export const targetOf = (proxy: any): any => proxy?.[$TARGET] ?? proxy?.[$THIN];
