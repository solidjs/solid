---
"@solidjs/signals": patch
---

Two `latest()` async readers under one async memo, with the second input written while the first one's flush is parked, ask each question once. A `latest()` reader whose frame lands at the seam no longer re-derives in the verdict lane, so its frame question isn't asked a second time. A verdict-lane pass that read a staging re-derives only while the transaction holding that staging stays parked, judged on that transaction rather than the lane's parent and not counting the pass's own render effect. Before, the memo asked a question twice and could show a value derived from the input's old answer next to its new one.

A `latest()` reader's lane answer now reaches the screen whatever the grouping. An `isPending()` effect beside the reader no longer makes it wait for an unrelated hold, and an async memo over `latest()` that only its own flight holds shows the lane's answer before the final one. A `[isPending(m), m()]` reader of a sync `latest()` memo no longer shows a pending pair with the old value before the lane's.
