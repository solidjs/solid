---
"solid-js": patch
---

Server: a `<Loading>` that fails after the shell while its fragment waits inside an outer `<Loading>` that is still pending no longer arrives as a blank region reported as a success. The failure now goes to the nearest enclosing boundary, as it does when the same read fails inside the outer `<Loading>`'s own render. An `<Errored>` between them draws its fallback in the outer fragment, the client adopts it, and its error is serialized with it. With no `<Errored>` between them, the outer fragment fails, and an `<Errored>` whose whole content is that outer `<Loading>` draws its fallback there. This also covers an `<Errored>` fallback that fails in that position. Before, the client hydrated the blank region and either halted or rendered nothing there (#4316).
