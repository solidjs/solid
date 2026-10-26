---
"solid-js": patch
---

An `<Errored>` boundary hydrated in the error state the server rendered now recovers. Before, it showed the server's error and tracked nothing, so it stayed on the fallback until `reset()` was called, even after the failed content's inputs changed. Now the content runs once on the client when hydration ends. If it fails again, the fallback stays, now showing the client's own error, and the boundary recovers when the content's inputs change or on `reset()`; the server's error only tells hydration to claim the fallback markup. If the error only happened on the server, the client's content replaces the fallback after hydration (#4273).
