---
"@solidjs/signals": patch
---

A boundary's fallback is instantiated once per show. An `<Errored>` whose content reads a failing async memo through a `<Show>` rendered its fallback twice for one failure and rebuilt it when a `reset()` retry failed again, losing focus on the Retry button (#3991). The fallback is now built in a scope of its own beside the boundary's output and kept while it shows; a later error reaches it through the error accessor. The same holds for a `<Loading>` fallback across the boundary's re-derives.
