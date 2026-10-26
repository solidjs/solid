---
"solid-js": patch
---

Hydration keeps a client-only boundary's served fallback (#4286). A `<Loading>` whose content reads a bare `ssrSource: "client"` source is served as its fallback plus the `"$$f"` marker; the client hydrated that fallback, then resumed the content, and when the content suspended on the question it now asks, the boundary built a second fallback and dropped the served one (losing focus, selection or a running animation in it). The hydrated fallback is now built in an owner that outlives the resume and is handed to the resumed boundary as its first fallback: it stays on screen until the content can show, and is disposed with it — or at once when the content shows straight away.
