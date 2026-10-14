---
"@solidjs/signals": patch
---

An outer `on`-reset Loading boundary no longer waits for a flight its nested `on`-reset boundary catches (D-14, U-4). A pending reader forwarded through both boundaries while neither was collecting was recorded in both, so when one tick re-armed both the outer kept its fallback until the inner's flight landed. A reader a nested collecting boundary holds is now that boundary's alone: the outer's content shows beside the inner's fallback as soon as the outer's own work lands.
