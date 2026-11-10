---
"@solidjs/web": patch
---

`insert` no longer carries the portal host tagging in a bundle that renders no `<Portal>`: Portal installs it on first use. A hand-written `insert(..., { host })` outside Portal now needs `installHostTagging()` first.
