---
"@solidjs/web": patch
---

Fix list-driver purity probe cascading into nested subtrees: while probing,
reactive work is recorded-and-skipped (effects and function-valued inserts
disqualify the row without building), so a declining probe on a container
row costs one shallow clone instead of recursively constructing and
discarding its subtree (O(N log N) waste on deep trees — 43x on uibench's
depth-10 tree render)
