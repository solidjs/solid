---
"solid-js": patch
"@solidjs/web": patch
---

An `<Errored>` around a `<Loading>` whose async read fails during a streamed render now shows its fallback in the server HTML outside server components too, and the client adopts it. Before, the boundary's HTML was empty until hydration (neither the loading nor the error fallback), and the hydrating client rendered the failed boundary from scratch: it asked again and showed the loading fallback. Now, when the `<Loading>` is all of the `<Errored>`'s content, the server draws the error fallback in its place (in the shell, or in the streamed fragment after the shell) and serializes the error at the `<Errored>`, so a client that hydrates after the failure arrived claims that markup and adopts its data without asking again, and recovers when the content's inputs change, as for any hydrated failure (#4273). A client that hydrated before the failure arrived renders it once, with nothing of the server's swap left beside it. With markup between the two boundaries the server still leaves the position blank and the client renders the failure (#4287).
