---
"@solidjs/signals": patch
---

Allow fresh mainline computations to publish a coherent committed first frame while a foreign transaction holds their inputs. After publication, continue those inputs through the new computation under the source transaction, including any downstream async work. Preserve normal entanglement for existing computations and mounts without a committed answer.
