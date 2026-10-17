---
"@solidjs/web": patch
"solid-js": patch
---

A live hole whose content calls a slot keeps updating. Before, the first re-run that called a slot latched the hole (`SSR_LIVE_HOLE_LATCHED`, cause "records"). Now each occurrence's identity belongs to its hole: it is its position there, or its `$key`. Calls outside any hole keep the ids they had. A re-run sends a record only for a new occurrence or for args that changed. On the client, the hole's morph resolves slot ranges against the frame's displaced-range index, the same way the root morph does. An occurrence that survives keeps its range, its interior and its mounted component, even when it moves into another hole. New occurrences mount and the ones that are gone dispose. Under deferred hydration, an occurrence that is not mounted yet claims its markup with the record that markup was rendered from, then takes the newer one. A live attribute that calls a slot still latches, and so does a re-run that creates owners.
