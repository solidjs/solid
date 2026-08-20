---
"@solidjs/web": patch
---

The shared frame host passes `delegateEvents` to `createFrameHost` as the new `delegate` option — behavior-claim event arming flows through platform glue instead of a core-entry global, keeping dom-expressions' tree-shaken client subsets free of the event system.
