---
"@solidjs/signals": patch
---

A section a change mounts now commits once its async memos land when two boundaries read `isPending()` of the same memo and that memo lands last (#4338). The nested reader's pending held the `isPending` lane, so the sibling boundary's output became a lane node before the lane had shown; its render effect, reading that node from the frame, had no committed value to show and went pending on no flight — and was registered to re-derive at the lane's reveal only when it did not throw. It held the change, the lane ends only when the change lands, and the old content stayed on screen for good. The reader is now registered for the reveal before it waits, so it re-derives there and the change commits whole.
