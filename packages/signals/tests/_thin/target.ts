import { $THIN } from "../../src/store/thin.js";

/** A store's internal record: value nodes on `n`, presence on `h`,
 * structure on `k`, the raw on `v`. */
export const targetOf = (proxy: any): any => proxy?.[$THIN];
