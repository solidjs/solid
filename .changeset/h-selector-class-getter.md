---
"@solidjs/h": patch
---

A getter `class` on a tag with static classes no longer throws "Invalid property descriptor". A component that forwards its props to a selector-class element (`props => h("button.btn", props)`) and is given a reactive `class` received it as a getter, and merging it with the static classes built a descriptor with both `get` and `value`. The getter is now read through the props object, so the merged class keeps the static classes and stays reactive.
