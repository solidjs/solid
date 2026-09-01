---
"@solidjs/signals": patch
---

until() now entangles the confirming transition with the awaiting action. When a foreign write (another action's landing, a stream echo, a store fold) flips an awaited until() predicate truthy, its staged nodes are stolen into the awaiting transaction and masked from ordinary readers (CONFIG_ENTANGLED) until the joint settle, so the confirmation and the action's own reveal paint in one frame instead of tearing. latest() and authoritative reads still see the staged truth; non-flipping updates on watched sources reveal freely; the confirming carrier keeps its own async reporters so open streams cannot deadlock the awaiting action.
