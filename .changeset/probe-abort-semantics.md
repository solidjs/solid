---
"@solidjs/web": patch
---

List-driver probe never lets user code observe the speculative build: the
first impurity marker (component creation, effect, memo, function-valued
insert, ref) ABORTS the probe via a sentinel instead of record-and-skip —
no refs handed never-mounted elements, no cleanups for rows that never
existed, no component bodies executed (caught by octane's effectful-list
work-count gate: refs 1001→1000, cleanups 1→0)
