---
"@solidjs/web": patch
---

Single-flight delivery now settles slice entries the server folded while still pending before handing the envelope to the flight-data consumers. A collector may fold values that are still in flight (the router's collector returns its preloads' `query` promises as they stand), and the codec streams those after the response head; since the body decode resolves on the first chunk, the mutation call resolved, and a router action settled (busy state cleared, `onSettled` ran) before the refreshed route data existed. `deliverFlightData`, shared by the plain client and the frames client, now waits for every pending entry (`allSettled`, so a failed read stays with the cache entry it seeds) before running consumers.
