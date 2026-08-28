---
"@solidjs/web": patch
---

Skip server-injected head-manager tags in the hydration claim walk. A
`useHead` charset/base registration is spliced as a prelude right after the
`<head>` open tag — ahead of every head child a full-document shell authored
itself — and the compiled shell's positional head traversal died on the
shift: a null `nextSibling` read that halted hydration for the whole
document. `getFirstChild`/`getNextSibling`/`getNextMatch` now step over
elements in `document.head` that carry `data-dh` without `data-dhf` while
hydrating; the `data-dhf` exemption keeps the server's in-place static
`<title>` rewrite claimable, since the rewrite always stashes the original
text there and injected tags never do.
