---
"solid-js": patch
---

On the server, an async memo's retry (when its source settles) runs under its own render's context instead of whichever concurrent render set it last (#3972). Under concurrent requests, slot content created by the retry took the other request's hydration ids, which could leave the server spinning or fail hydration with "Hydration key miss".
