/**
 * Single-flight mutations, client half + shared contract.
 *
 * The mutation's response carries the post-mutation values for the queries the
 * page is showing, so the UI updates without a follow-up read. The server half
 * (`createQueryFlightCollector`) lives on the `/server` subpath — it pulls in
 * `provideRequestEvent` (node:async_hooks), which doesn't belong in client
 * bundles.
 */
// Bare specifier on purpose: the compiled server-function references import
// '@solidjs/web/server-functions', and bundlers give each specifier its own
// module instance — the '/client' subpath would register the consumer in a copy
// the transport never reads. It also keeps this module importable from an SSR
// graph: the server build exports `subscribeFlightData` too.
import { subscribeFlightData } from "@solidjs/web/server-functions";
import { isServer } from "@solidjs/web";
import { query, revalidate } from "./query.js";

export interface QueryFlightData {
  href: string;
  /** Post-mutation query results, resolved on the server: key -> value. */
  queries: Record<string, unknown>;
}

/**
 * Registers the flight-data consumer that applies single-flight query payloads.
 * Call once on the client, before mutations can run (the client entry is the
 * natural place). Subscribing IS the single-flight opt-in: the transport only
 * sends the request-leg header, and the server only collects, while a consumer
 * is registered — and only one can be active, so register it after any other
 * integration that would claim the slot.
 */
export function installQueryFlightConsumer() {
  if (isServer) return;

  subscribeFlightData<QueryFlightData>(data => {
    if (!data?.queries) return;
    // The payload describes the location the mutation ran against; if the
    // user navigated (or the mutation redirected) while it was in flight,
    // seeding would write another page's data — refetch instead.
    if (data.href !== window.location.href) return revalidate();

    // `query.set` bumps each entry's version signal, so memos reading the
    // query re-run with the fresh value — no client refetch.
    for (const [key, value] of Object.entries(data.queries)) {
      query.set(key, value as never);
    }
  });
}
