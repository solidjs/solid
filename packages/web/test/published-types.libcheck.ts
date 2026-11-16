// The published declarations, checked as a consumer with `skipLibCheck: false`
// sees them (tsconfig.test.libcheck.json). A declaration that imports a name
// `solid-js` strips from its own (`@internal` + `stripInternal`) fails here:
// rc.22's client.d.ts imported `heldRead` from "solid-js". A runtime seam
// comes from `solid-js/internal`, which declares it.
import "@solidjs/web";
import "@solidjs/web/storage";
import "@solidjs/web/performance-tracks";
import "@solidjs/web/serialization";
import "@solidjs/web/serialization/decode";
import "@solidjs/web/server-functions";
import "@solidjs/web/server-functions/server";
import "@solidjs/web/server-functions/client";
import "@solidjs/web/server-functions/rich-args";
import "@solidjs/web/frames";
import "@solidjs/web/frames/server";
import "@solidjs/web/frames/client";
import "@solidjs/web/frames/trace";
import "@solidjs/web/frames/regions";
import "@solidjs/web/frames/assets";
import "@solidjs/web/frames/wire";
