---
"@solidjs/web": patch
---

Measure `bodySizeLimit` on the bytes a server-function call actually sends, and settle an aborted upload whichever way its length was framed. Dispatch decided how to pay for the body from the declaration alone — `if (!(declared > 0))` — so any positive digit string skipped the counting read: `Content-Length: 10` on a 2 MiB body dispatched the whole 2 MiB past a 1 MiB cap, believing the same header, from the same untrusted producer, whose `-1` #3153 had already established must not be believed. That gate also carried the upload lifecycle, so the signal/reader coupling of #3218 was installed only for bodies that declared no length: an ordinary browser POST abandoned mid-upload never settled its handler and never cancelled its upload source (#3217/#3219). A declaration is now only ever grounds for refusing a payload the peer has itself announced as oversized, before a byte is read; every body a capped route accepts goes through the bounded read.
