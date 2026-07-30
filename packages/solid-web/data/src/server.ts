/**
 * Single-flight mutations, server half.
 *
 * `createQueryFlightCollector(warmQueries)` produces the `collectFlightData`
 * hook for `configureServerFunctionsServer`: it re-establishes the request
 * scope, derives the location the client will show once the mutation settles,
 * asks the host to re-run that location's data loading (`warmQueries` — the
 * only host-specific piece), then resolves this request's query cache into the
 * payload the client applies (see ../flight.ts).
 *
 * `warmQueries` runs inside the request-event scope; whatever data loading it
 * triggers should call the app's `query()` wrappers (typically route
 * loaders/preloads doing `void someQuery()`), which is what warms the cache.
 *
 * Lives on its own subpath because it imports `@solidjs/web/storage`
 * (node:async_hooks) — keep it out of client bundles.
 */
import type {
  CollectFlightDataHook,
  ServerFunctionOutcome
} from "@solidjs/web/server-functions/server";
import { provideRequestEvent } from "@solidjs/web/storage";
// Bundled copy of the query module. Sharing an instance with the app's client
// bundle doesn't matter here: the server cache lives per-request in
// `getRequestEvent().locals`, not in module state.
import { collectQueries } from "./query.js";
import type { QueryFlightData } from "./flight.js";

export function createQueryFlightCollector(
  warmQueries: (href: string, outcome: ServerFunctionOutcome) => Promise<void> | void
): CollectFlightDataHook {
  return (event, outcome) =>
    // The hook runs outside the request-event scope; re-establish it or the
    // per-request query cache has no event to hang on (and in-process server
    // function calls throw "Cannot call server function outside of a request").
    provideRequestEvent(event as Parameters<typeof provideRequestEvent>[0], async () => {
      if (outcome.thrown) return undefined;
      // Where the client will be once this settles: a redirect's target, else
      // the page it submitted from (same-origin fetches send a full Referer).
      const href =
        outcome.response?.headers.get("Location") ?? outcome.request.headers.get("referer");
      if (!href) return undefined;

      await warmQueries(href, outcome);

      // Single-flight is the point: the response waits for the data.
      const queries: Record<string, unknown> = {};
      await Promise.all(
        Object.entries(collectQueries()).map(async ([key, promise]) => {
          try {
            queries[key] = await promise;
          } catch {
            // failed queries just aren't shipped; the client refetches on demand
          }
        })
      );
      return { href, queries } satisfies QueryFlightData;
    });
}

export type { QueryFlightData };
