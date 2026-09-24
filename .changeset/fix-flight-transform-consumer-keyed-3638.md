---
"@solidjs/web": patch
---

Single-flight mutations that revalidate a server component answer with a frame stream again, and single-flight delivery is one shared path (#3638).

The fold keys flight data by source — `{ [source]: slice }`, the unnamed collector's slice under `"true"` — but `frameTransformFlightResult` scanned only the top level of `data` for components, framed nothing, and the handler fell back to the plain codec, which cannot encode a function (`Server function result could not be encoded … "function"`). Every single-flight mutation revalidating a server component (the router's `createFlightDataCollector` with server-component routes) failed. The transform now scans each source's slice, frames component-valued entries as regions addressed by their call (a bare function entry is addressed by its key), and keeps the source keys in the serialized envelope.

Two more halves of the same protocol drift are fixed alongside: the frames client delivered the whole keyed envelope to the unnamed consumer only, and the frame policy stamped a bare `X-Single-Flight: true` that won the header merge and dropped named sources. Delivery is now one implementation in `@solidjs/web/server-functions` (`deliverFlightData`, internal) that both the plain client and the frames client call — each registered consumer receives its own slice, in registration order, with identical metadata handling — and the fold owns the single-flight header on every body shape.

`ServerComponentHandlerOptions.consumer` and `.codec` (`@experimental`) are removed: they existed for a bundling condition (two copies of the server-function client) that the frames build rules out by construction.
