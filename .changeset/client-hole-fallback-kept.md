---
"solid-js": patch
---

Hydration keeps a client-only boundary's served fallback (#4286). A `<Loading>` whose content reads a bare `ssrSource: "client"` source is served as its fallback plus the `"$$f"` marker; the client hydrated that fallback, then resumed by re-running the boundary, and when the content suspended on the question it now asks, the new boundary built a second fallback and dropped the served one (losing focus, selection or a running animation in it). The `"$$f"` route now creates the loading boundary once, at hydration: its content waits on the resume and its fallback hydrates the served one (built at the boundary's id, as the server built it), so content that suspends after the resume keeps the hydrated fallback until it can show.
