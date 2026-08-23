---
"solid-js": patch
---

Server async plumbing allocation trims: the settled-slot flight memory (#3003) moves from a WeakMap-of-Maps to a symbol-keyed plain object on the render context with in-place record transitions (recordSlot was the top allocation site in shell profiles), and ssrLoadingBoundary reads its parent contexts without owner switches and only pays the reveal-group severing setContext clone when a group is actually in scope.
