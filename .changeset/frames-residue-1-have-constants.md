---
"@solidjs/web": patch
---

`FRAME_HAVE_HEADER` and `FRAME_HAVE_BUDGET` leave the `@solidjs/web/frames` client entry's export list (frames residue pass §2 row 5a). They stay exported from `@solidjs/web/frames/server`, where the header is read; the client sends the have-list itself through the handler's `resume` and nothing consumed the names off the client entry. Removed public surface, `@experimental`.
