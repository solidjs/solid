---
"@solidjs/signals": patch
---

An async memo's held landing keeps the committed frame's dependencies (#3461).

- `selected = createMemo(async () => (b() ? b() : a()))` with `b` held by a slow flight: selected's held pass read only `b`, and its landing trimmed `a` at once, before the write staged the landed value under the hold. A later mainline `a` write no longer reached selected, so `A: 1` committed beside `Selected: 0` while `B` still read 0. The landing now trims only when it published (A30, the landing twin of a staged sync pass); a transition-held landing leaves the tail for its commit, so the `a` write reaches selected and joins the hold, and the four values reveal as one frame.
