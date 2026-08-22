---
"@solidjs/web": patch
---

Pin hydration id parity for a conditional expression in a forwarded JSX prop (#3033). On rc.1 the prop getter's compiler-minted condition memo consumed a flat sibling id slot at read time, and the two sides read the getter at different walk points (server: open-tag attribute serialization, before children; client: attribute effect, after claiming them), so the forwarded keyed child failed its claim. On next the forwarded child keys compose under the memo's own id scope, which both sides agree on regardless of read order — a parity-harness scenario now guards this. Also documents why the `_$memo` runtime binding must NOT be transparent: the ssr generate wraps whole hole bodies in it, making its id slot the retry-stable scope deferred holes re-run under.
