---
"@solidjs/signals": patch
---

A render effect that stops reading a pending async memo no longer keeps the memo's source held. A pending reporter that recovers without its flight landing — its pass no longer reads the source, e.g. a `show()` gate closed — is a completion event for the transaction it reported to: `recompute` now wakes that parked transaction (`wokenTransitions`, the third site after disposal #3372 and boundary reset #3375) so it is re-judged and its held writes commit. Before, `reporterBlocksSource` already judged the effect dead but nothing re-asked the parked transaction, and an ordinary write to the source stayed staged for as long as the flight stayed up — forever when it never landed. Found by the semantic fuzzer (#3446, law P1, 21/1000 cases) and reproduced as the posture matrix's `effect × gatedAway` cell.
