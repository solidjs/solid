---
"@solidjs/compiler": patch
---

Key server-function ids on identity instead of position (#3109). Production ids were `<xxhash32(path)>-<ordinal>`, so appending a server function to a file renumbered the others and every client holding the old numbering silently dispatched to different code with a 200. Ids are now `<name>-<xxhash32(root-relative path)>`, with a trailing ordinal only when the same descriptive name recurs within one file — appends, deletes, reorders, and body edits no longer move any address, and a removed or renamed function becomes a clean 404 instead of a wrong call. Development and production now share the exact same id format.
