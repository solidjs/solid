---
"@solidjs/signals": patch
---

Fix L2 lane regressions found by the semantic fuzzer: a lane dissolving with a node still in flight marks it as committed beneath published inputs, so a mount or verdict reader observes the flight instead of being served a value that tears against them; a correction of a blocked lane drops the re-guess runs it parked instead of releasing them; and a lane pass's pending propagation no longer lists a born-held or mid-pass mainline render effect on the lane, so a mount over a memo of a lane flight is born held, control and content together.
