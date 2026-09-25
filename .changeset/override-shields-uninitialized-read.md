---
"@solidjs/signals": patch
---

An armed derived override shields an untracked read of an uninitialized node (A18 (d), follow-up to #3651)

A memo whose first async landing rode its optimistic lane keeps `STATUS_UNINITIALIZED` (its value sits in the derived-override slot until the lane's commit promotes it). When the action then fails, the memo re-derives from the truth and is pending in the body-end window while its override is still displayed. An untracked read of it in that window — from ambient code, with no reader identity — threw `NotReadyError`: `read()`'s uninitialized-pending throw fired ahead of `serve()`'s override arm. It now returns the override, as the same read of an initialized node re-deriving under its override already did. Tracked readers are unchanged: lane readers keep the override, off-lane readers suspend.
