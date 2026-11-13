---
"@solidjs/web": patch
---

Delegated events no longer keep an unmounted component alive through `currentTarget`. Event delegation simulated `currentTarget` with a getter created for each event, and V8 can keep the first such getter in the shape every event of that type shares, along with the event, its target and the component around it. `currentTarget` is now set as a plain value when a delegated handler runs.
