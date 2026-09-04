---
"@solidjs/web": patch
---

Guard failure channels under an Error carrier's non-enumerable own data slots (#3268). The #3235 guard walked Error carriers with `Object.keys`, but seroval encodes an Error's own properties through `getOwnPropertyNames` — so a rejected promise or erroring stream parked on a non-enumerable slot (`cause` is non-enumerable by spec since ES2022, and the ordinary place a wrapped driver error carries its context) was encoded without ever being walked: its failure reason rode the wire verbatim on a committed 200, and the rejection had no owner. The guard now descends an Error's own string-keyed data slots, enumerable or not. Hidden accessors remain the codec's read (47995412's pinned ruling): the walk still does not invoke what the author hid.
