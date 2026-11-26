---
"@solidjs/web": patch
---

A server render under a request event now adds the client entry's assets to the response as a `Link` header: the entry script and its static imports as `rel=modulepreload`, and their stylesheets as `rel=preload; as=style`. Hosts and CDNs that build `103 Early Hints` from `Link` headers, such as Cloudflare, can then start those downloads before the page arrives. It covers the static build manifest only, so dev renders add nothing, and `noScripts` renders hint only stylesheets.
