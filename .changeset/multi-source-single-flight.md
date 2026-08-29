---
"@solidjs/web": minor
---

Multi-source single-flight: named flight-data sources alongside the unnamed hook

The single-flight channel assumed exactly one data-owning integration — one
`collectFlightData` hook on the server, one `subscribeFlightData` consumer on
the client, later registrations displacing earlier ones. An app running two
caches (a router's route data and a query library's client) had no way to
refresh both from one mutation response: whichever library registered last
silently won.

The channel now multiplexes named sources over the same round trip:

- `registerFlightDataSource(id, hook)` (server) registers a collector
  additively next to the unnamed `collectFlightData` slot, which remains the
  data-owning integration's (a router's).
- `subscribeFlightData(id, consumer)` (client) subscribes a consumer to its
  source's slice; the bare legacy signature keeps meaning the unnamed source.
- The request-leg `X-Single-Flight` header now carries the subscribed source
  ids, so the server only runs collectors the client can consume; the
  response leg echoes the ids actually folded, making the payload shape
  self-describing. With named sources in play, `data` is the keyed envelope
  `{ [source]: slice, ... }` and each slice is delivered to its consumer,
  awaited, before the mutation's promise resolves.

Fully wire-compatible in every cross-version pairing: a lone unnamed
registration still sends and echoes the literal `true` with the raw payload
shape, byte-identical to the previous protocol, and unrecognized opt-in
values from hand-tagged requests still reach the unnamed hook. Existing
integrations (Solid Router, TanStack Solid Start) keep working unchanged; the
keyed envelope only materializes when a named source registers on both ends.
