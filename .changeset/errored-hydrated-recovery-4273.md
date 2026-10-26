---
"solid-js": patch
---

An `<Errored>` boundary hydrated in the error state the server rendered now recovers. Before, hydration threw the server's error without running the content, so the boundary tracked nothing and stayed on the fallback until `reset()`, even after the failed content's inputs changed. Now the content runs during hydration, reading its server data without refetching but claiming no DOM, while the fallback claims the server's markup. If the content fails on the client, the boundary holds that client error and recovers when the content's inputs change. If the error only happened on the server, the server's fallback and error stay up until `reset()` is called or the content re-runs (#4273).
