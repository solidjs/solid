---
"@solidjs/web": patch
"solid-js": patch
---

A server component in a document marks its live holes only once the render has served something a later commit can replace: an async iterable it pumps, or a loading value or seed shown ahead of its landing. Until then a hole that resolves synchronously ships without `lh` markers, `data-lha` addresses or a ledger binding, because no channel op can ever address it. On a request/response page that is every hole: the 1,406-comment hackernews thread drops from 948 KB to 787 KB and renders in about half the server time.
