// Tier-1 SSR-lane bench for a direct server-function call's result walk: the
// call an SSR `query()` makes, returning 1,000 plain rows. The direct road
// walks the result to bind deferred bodies to the call's request scope; a
// result with nothing deferred should hand its containers back unbuilt.
//
//   - plain rows: nothing to bind anywhere in the graph
//   - one deferred body: the same rows plus a cursor, so the root rebuilds

import { AsyncLocalStorage } from "node:async_hooks";
import { bench } from "vitest";
import { createRequestEvent } from "@solidjs/web";
// the bench config aliases only the core server build; this is the built bundle
import { createServerReference } from "../../server-functions/dist/server.js";

const RequestContext = Symbol.for("solid.RequestContext");
const requestContext = new AsyncLocalStorage<any>();
(globalThis as any)[RequestContext] = requestContext;

const rows = Array.from({ length: 1000 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  name: `row ${i}`
}));

async function* cursor() {
  yield "one";
}

const plain = createServerReference({
  id: "bench-direct-plain",
  fn: () => rows
} as any) as () => typeof rows;
const deferred = createServerReference({
  id: "bench-direct-deferred",
  fn: () => ({ rows, more: cursor() })
} as any) as () => { rows: typeof rows };

const event = createRequestEvent(new Request("https://app.example/page"));

bench("direct call, 1,000 plain rows", () => {
  requestContext.run(event, () => plain());
});

bench("direct call, 1,000 rows and one deferred body", () => {
  requestContext.run(event, () => deferred());
});
