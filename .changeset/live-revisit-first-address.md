---
"solid-js": patch
"@solidjs/web": patch
---

A `dynamic` mount of a live server component that switches arguments and comes back to its first call (a windowed view scrolling back to the slice the page was served with) shows that call again. The equals gate compared the incoming binding with the one the memo holds, which is the first resolution's, so the way back read as "nothing changed" and the mount stayed on the other address.

A live connection cancelled before its body's `start` arrived now reads as a death, and the loop reconnects. A remount replaying a warm store gives up on a row-op record by cancelling the new connection so the resume re-sends the hole whole; with nothing open yet, the end read as a completion and the mount was left with no live connection.
