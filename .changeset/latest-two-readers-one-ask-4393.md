---
"@solidjs/signals": patch
---

Two `latest()` async readers under one async memo, with the second input written while the first one's flush is parked, ask each question once. A `latest()` reader whose frame lands at the seam no longer re-derives in the verdict lane, so its frame question isn't asked a second time. A verdict-lane pass that read a staging re-derives only while the transaction holding that staging stays parked, judged on that transaction rather than the lane's parent and not counting the pass's own render effect. Before, the memo asked a question twice and could show a value derived from the input's old answer next to its new one.
