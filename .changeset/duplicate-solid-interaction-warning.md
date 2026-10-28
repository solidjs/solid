---
"solid-js": patch
---

The dev "multiple instances of Solid" warning now fires when two copies actually meet (a component or `useContext()` from one copy runs inside a component rendered by another, with no owner) instead of whenever a second copy loads. Isolated copies, such as a devtools panel rendering into its own root or a Solid 1 copy on the same page, no longer warn (#2549). Solid 2 no longer sets v1's `globalThis.Solid$$` flag.
