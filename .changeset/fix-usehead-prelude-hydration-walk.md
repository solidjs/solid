---
"@solidjs/web": patch
---

Fix whole-document hydration dying when `useHead` coexists with shell-authored `<head>` children (#3081). A charset/base registration is spliced as a prelude immediately after the `<head>` open tag — a deliberate byte-placement constraint — landing it ahead of every head child the shell authored itself. The compiled head traversal is positional (raw `firstChild`/`nextSibling` chains in production), so the prepended tag shifted every read by one and hydration for the whole document died on a null read. `hydrate()` now moves the registry-inserted leading run (`data-dh` without the `data-dhf` in-place-rewrite stash) to the end of head before any claiming: the parser already consumed the byte-placement guarantees, the moved metas are inert in an unrendered element, and the walk sees exactly the shell's authored children. The in-place rewritten static `<title>` keeps its stash, its position, and its claim.
